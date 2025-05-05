'use server';

import type { z } from 'zod';
import * as zod from 'zod';
import * as xlsx from 'xlsx';
import AdmZip from 'adm-zip';

// --- Translated Helper Functions (from Python logic) ---

/**
 * Splits a string by a delimiter, respecting quotes.
 * (Translated from Python safe_split_outside_quotes)
 * @param s The string to split.
 * @param delimiter The delimiter character (default: '.').
 * @returns An array of split parts.
 */
function safeSplitOutsideQuotes(s: string, delimiter: string = "."): string[] {
    const result: string[] = [];
    let current: string[] = [];
    let inQuotes = false;
    for (const char of s) {
        if (char === '"') {
            inQuotes = !inQuotes;
        }
        if (char === delimiter && !inQuotes) {
            result.push(current.join(""));
            current = [];
        } else {
            current.push(char);
        }
    }
    if (current.length > 0) {
        result.push(current.join(""));
    }
    return result;
}

/**
 * Loads the mapping from an Excel file buffer using the specified sheet name.
 * (Translated from Python load_mapping_from_excel, using xlsx instead of pandas)
 * @param fileBuffer Buffer containing the Excel file content.
 * @param fileName Original filename (for error messages).
 * @param sheetName Name of the sheet containing the mapping.
 * @returns A dictionary mapping Playwright methods to Robot keywords.
 */
async function loadMappingFromExcel(fileBuffer: Buffer, fileName: string, sheetName: string): Promise<{ [key: string]: string }> {
    try {
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        if (!workbook.SheetNames.includes(sheetName)) {
            throw new Error(`Sheet "${sheetName}" not found in ${fileName}. Available sheets: ${workbook.SheetNames.join(', ')}`);
        }
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
            throw new Error(`Sheet "${sheetName}" could not be loaded from ${fileName}`);
        }
        // Assuming columns are named exactly as in the Python code
        const jsonData = xlsx.utils.sheet_to_json<{
            Actual_core_python_playwright_methods: any; // Use 'any' initially
            browser_library_keyword: any;
        }>(worksheet, { defval: null }); // Use defval: null to better handle empty cells

        const mapping: { [key: string]: string } = {};
        jsonData.forEach(row => {
            // Convert to string and trim, handle potential null
            const playwrightMethod = row.Actual_core_python_playwright_methods !== null ? String(row.Actual_core_python_playwright_methods).trim() : '';
            const robotKeyword = row.browser_library_keyword !== null ? String(row.browser_library_keyword).trim() : '';

            // Ensure both values are non-empty after conversion and trimming
            if (playwrightMethod && robotKeyword) {
                mapping[playwrightMethod] = robotKeyword;
            } else {
                 // console.log('Skipping row due to missing/null data:', row);
            }
        });

        if (Object.keys(mapping).length === 0) {
             console.warn(`Mapping loaded from sheet "${sheetName}" in ${fileName} is empty. Check column names ('Actual_core_python_playwright_methods', 'browser_library_keyword') and ensure data exists.`);
        }
        return mapping;
    } catch (error: any) {
        console.error(`Error loading mapping from Excel buffer (${fileName}, Sheet: ${sheetName}): ${error.message}`);
        throw new Error(`Failed to load mapping from ${fileName} (Sheet: ${sheetName}): ${error.message}`);
    }
}


/**
 * Finds the nearest matching Robot keyword for a given Playwright method signature.
 * Checks if the method_name is a substring of any key in the mapping.
 * (Translated from Python find_nearest_match)
 * @param method_name_with_parens The Playwright method signature (e.g., "click()"). Must include '()'
 * @param mapping The mapping dictionary.
 * @returns The corresponding Robot keyword or the original method name (without '()') if no match found.
 */
function findNearestMatch(method_name_with_parens: string, mapping: { [key: string]: string }): string {
    for (const key in mapping) {
        // Ensure key is a string and method_name_with_parens is a substring of the key
        if (typeof key === 'string' && key.includes(method_name_with_parens)) {
             return mapping[key]; // Return the mapped Robot keyword
        }
    }
    // Python logic returns the method name itself if no match, replicating that.
    return method_name_with_parens; // Return original with parens as per python logic
}


/**
 * Extracts a locator string suitable for Robot Framework from Playwright locator text.
 * Handles specific Playwright patterns like #id, name="value", and ("value").
 * (Translated from Python extract_locator)
 * @param locator_text The raw locator text from Playwright code (e.g., 'locator("#myId")', 'get_by_role("button", name="Submit")', 'page.locator("text=Submit")').
 * @returns A formatted locator string (e.g., "\\#myId", '"Submit"', '"text=Submit"').
 */
function extractLocator(locator_text: string): string {
    // Handle ID selectors: #myId -> \#myId (matches Python logic)
    if (locator_text.startsWith("#")) {
         return `\\${locator_text}`; // Prefix with backslash for RF ID locator
    }

    // Handle name attributes: ... name="Submit" ... -> "Submit" (matches Python logic)
    let match = locator_text.match(/name\s*=\s*["']([^"']+)["']/);
    if (match) {
        return `"${match[1]}"`; // Return just the name value in quotes
    }

     // Handle simple quoted strings within parentheses: ("some value") -> "some value" (matches Python logic)
     match = locator_text.match(/^\(\s*["']([^"']+)["']\s*\)$/);
     if (match) {
          return `"${match[1]}"`; // Return the content within quotes
     }

    // Handle strings that might be direct locators without parens, e.g. "text=Login"
    // If it's already quoted, return as is. If not, quote it.
    if (locator_text.startsWith('"') && locator_text.endsWith('"')) {
        return locator_text;
    } else if (locator_text.startsWith("'") && locator_text.endsWith("'")) {
         // Convert single quotes to double quotes for consistency
        return `"${locator_text.slice(1, -1)}"`;
    } else if(locator_text) {
         // If it's not empty and not quoted, quote it (Python's final case)
         return `"${locator_text}"`;
    }

    // Fallback: return original text if none of the patterns match
    // console.warn(`Could not extract standard locator from: ${locator_text}. Returning original (quoted).`);
    return `"${locator_text}"`; // Default to quoting the input
}

/**
 * Aligns Robot Framework test case steps with standard indentation.
 * Preserves original lines for sections, comments, and blank lines.
 * Indents test steps with 4 spaces.
 * (Revised based on Python align_robot_test_cases logic)
 * @param inputContent The raw content of the .robot file.
 * @returns Formatted content string.
 */
function alignRobotCode(inputContent: string): string {
    const lines = inputContent.split('\n');
    const formattedLines: string[] = [];
    let insideTestCase = false;
    let insideVariables = false;
    let insideSettings = false;
    const testCaseIndent = '    '; // 4 spaces

    for (const line of lines) {
        const strippedLine = line.trim();

        // Preserve section headers, comments, and blank lines as is
        if (strippedLine.startsWith('***') || strippedLine.startsWith('#') || !strippedLine) {
            formattedLines.push(line);
            if (strippedLine.startsWith('***')) {
                insideTestCase = strippedLine.toUpperCase().includes('TEST CASES');
                insideVariables = strippedLine.toUpperCase().includes('VARIABLES');
                insideSettings = strippedLine.toUpperCase().includes('SETTINGS');
            }
            continue;
        }

        // Handle Variables and Settings sections - preserve original line
        if (insideVariables || insideSettings) {
            formattedLines.push(line);
            continue;
        }

        // Handle Test Cases section
        if (insideTestCase) {
            // Test Case Name (starts with non-space)
            if (line.match(/^\S/)) {
                 formattedLines.push(line); // Preserve original line (should be left-aligned)
            }
            // Test Case Step (has content but doesn't start with non-space, or is indented)
            else {
                // Indent the stripped line content
                 formattedLines.push(testCaseIndent + strippedLine);
            }
            continue;
        }

        // Handle lines before any section (likely keywords or implicit test case names)
        // Treat as potential test case name - preserve original line
        formattedLines.push(line);
         // Heuristic: Assume we might enter test cases implicitly if we see non-section, non-empty lines
         // before the *** Test Cases *** section is explicitly found.
         if (!insideSettings && !insideVariables && !insideTestCase && strippedLine) {
             insideTestCase = true; // Assume start of test cases
         }
    }

    // Join lines back, ensuring a single trailing newline if the input had one (or was non-empty)
    let result = formattedLines.join('\n');

    // Remove multiple trailing newlines but keep at least one if original content wasn't empty and ended with newline.
    if (inputContent && inputContent.endsWith('\n')) {
        result = result.replace(/\n+$/, '\n');
    } else {
         result = result.replace(/\n+$/, ''); // Remove all trailing newlines if original didn't have one
    }

    return result;
}


/**
 * Converts a single Playwright Python script content to Robot Framework format.
 * Based closely on the provided Python conversion logic.
 * @param inputCode The content of the Python script.
 * @param mapping The Playwright-to-Robot keyword mapping.
 * @returns The generated Robot Framework code as a string.
 */
function convertSinglePlaywrightCode(inputCode: string, mapping: { [key: string]: string }): string {
    const outputLines = ["*** Settings ***", "Library    Browser"];
    const variableLines = ["*** Variables ***", "${BROWSER}    firefox"]; // Default from Python script
    let testCaseLines: string[] = ["*** Test Cases ***"]; // Initialize here
    let urlCounter = 1;
    const urlMapping: { [key: string]: string } = {};
    let writingStarted = false;
    let firstGoto = true;
    let variable_counter = 1; // Initialize variable_counter
    let contextCloseFound = false;
    // let insideTestCaseDefinition = false; // Track if we are inside a test case block

    const rawLines = inputCode.split("\n");
    let lines: string[] = [];

    // Pre-processing for page.once (from Python logic)
    rawLines.forEach(line => {
        if (line.trim().startsWith("page.once")) {
            // Python code replaces page.once with these two specific lines (using Python indentation)
            lines.push('    ${promise} =       Promise To    Wait For Alert    action=accept   # text=<text content of alert box if you want to assert>');
            lines.push('    # <Line which triggers the alert action> ex click  <button>');
        } else {
            lines.push(line);
        }
    });

    for (const line of lines) {
        const stripped_line = line.trim();

        if (!stripped_line || stripped_line.startsWith('#')) {
            continue; // Skip empty lines and comments
        }

        // Handle context.close()
        if (stripped_line === "context.close()") {
            contextCloseFound = true;
            break; // Exit processing as per Python logic
        }

        // Handle expect() - Following Python structure
        if (stripped_line.startsWith("expect(")) {
            const variable_name = `\${var${variable_counter}}`;
            variable_counter++; // Increment the counter correctly

            // Python regex: r'locator\("([^"]+)"\)'
            const locatorMatch = stripped_line.match(/locator\("([^"]+)"\)/);
            if (locatorMatch) {
                 let locator_text = locatorMatch[1];
                 // Python logic: if "#" in locator_text: locator_text = r"\#" + locator_text.split("#")[-1]
                 if (locator_text.includes("#")) {
                     locator_text = `\\#${locator_text.split("#").pop()}`; // Use pop() for last element
                 }
                 // Python logic adds these lines for expect:
                 testCaseLines.push(`${variable_name}    Set Variable    ${locator_text}`); // Indentation will be handled by alignRobotCode
                 testCaseLines.push(`Wait For Elements State    ${variable_name}    visible    timeout=10s`);

                // Python regex: r'to_contain_text\("([^"]+)"\)'
                const expectedTextMatch = stripped_line.match(/to_contain_text\("([^"]+)"\)/);
                if (expectedTextMatch) {
                    const expected_text = expectedTextMatch[1];
                     // Python uses 'Get Text' keyword for assertion:
                    testCaseLines.push(`Get Text    ${variable_name}    ==    ${expected_text}`); // Using '==' for assertion based on RF common practice
                }
            }
            continue; // Move to next line
        }

        // Handle page.goto() - Following Python structure
        // Python regex: r'page\d*\.goto\("[^"]+"\)'
         const gotoMatch = stripped_line.match(/page\d*\.goto\(['"]([^'"]+)['"]\)/);
         if (gotoMatch) {
             writingStarted = true;
             const url = gotoMatch[1];

             if (firstGoto) {
                 // Python adds "Test Case" name (literal) and Browser/Context/Page setup
                 testCaseLines.push("Test Case"); // Literal name from Python
                 // insideTestCaseDefinition = true;
                 // Python line: "New Browser ${BROWSER} headless=False timeout=60000 slowMo=0:00:01"
                 // RF Browser doesn't directly support slowMo like this, using standard keywords.
                 testCaseLines.push(`New Browser        ${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'firefox'}        headless=False`); // Align handled later
                 // Python line: "New Context viewport={'width': 1920, 'height': 1080}"
                 testCaseLines.push(`New Context        viewport={'width': 1920, 'height': 1080}`); // Align handled later
                 // Python uses URL variable mapping
                 let var_name = urlMapping[url];
                 if (!var_name) {
                     var_name = `\${URL${urlCounter}}`;
                     urlMapping[url] = var_name;
                     if (!variableLines.some(v => v.startsWith(var_name))) {
                        variableLines.push(`${var_name}    ${url}`);
                     }
                     urlCounter++;
                 }
                 // Python line: "New Page ${URL<counter>}"
                 testCaseLines.push(`New Page            ${var_name}`); // Align handled later
                 firstGoto = false;
             } else {
                 // Subsequent navigations just use "Go To"
                 let var_name = urlMapping[url];
                 if (!var_name) {
                     var_name = `\${URL${urlCounter}}`;
                     urlMapping[url] = var_name;
                      if (!variableLines.some(v => v.startsWith(var_name))) {
                         variableLines.push(`${var_name}    ${url}`);
                      }
                     urlCounter++;
                 }
                 // Use Go To keyword for subsequent navigations in RF
                 testCaseLines.push(`Go To    ${var_name}`); // Align handled later
             }
             continue; // Move to next line
         }

        // Skip lines before the first goto or implicit start
        if (!writingStarted) {
            continue;
        }

        // Handle browser.close() - Following Python structure
        if (stripped_line.startsWith("browser.close")) {
             // Python adds "Close Browser" indented
             testCaseLines.push("Close Browser"); // Align handled later
             writingStarted = false; // Stop processing after browser close
             continue;
        }

        // General command processing - Following Python structure
        const parts = safeSplitOutsideQuotes(stripped_line, '.');
        const commandParts = parts.map(part => part.trim()).filter(part => part); // Python: parts = [part.strip() for part in parts if part.strip()]

        if (commandParts.length < 1) { // Python: if not parts: continue
            continue;
        }

         // Python logic: method is last part, locator_chain is parts[1:-1]
         const methodPart = commandParts[commandParts.length - 1]; // Python: method = parts[-1]
         const locatorChainParts = commandParts.slice(0, -1); // Python: locator_chain = parts[:-1] (Includes page/context)


         // Python regex: r'([a-zA-Z_]+)\((.*)\)'
        const methodMatch = methodPart.match(/^([a-zA-Z_]+)\((.*)\)$/);
        if (methodMatch) {
            const method_name_only = methodMatch[1];
            const method_name_signature = `${method_name_only}()`; // Python: method_name = method_match.group(1) + "()"
            let method_args_raw = methodMatch[2]?.trim() ?? ''; // Python: method_args = method_match.group(2)

            const transformed_method = findNearestMatch(method_name_signature, mapping); // Python: transformed_method = find_nearest_match(...)

            // Locator extraction based on Python logic (locator_chain is parts[1:-1])
            // Python example: page.locator("#id").click() -> parts = ['page', 'locator("#id")', 'click()'] -> locator_chain = ['locator("#id")']
            // Python example: page.get_by_role("button", name="Submit").click() -> parts = ['page', 'get_by_role("button", name="Submit")', 'click()'] -> locator_chain = ['get_by_role("button", name="Submit")']
            let locator_text = "";
            // Get the actual locator part, which is typically the second to last part if chain exists
            const locatorChain = commandParts.slice(1, -1); // Extract potential locator chain parts

            if (locatorChain.length > 0) {
                // Join the chain parts back temporarily to handle potential nested structures, then extract
                const potential_locator = locatorChain.join('.'); // Re-join locator chain parts
                locator_text = extractLocator(potential_locator);
            } else if (method_args_raw) {
                // If no locator chain, check if args look like a locator
                const extractedFromArgs = extractLocator(method_args_raw);
                 // If extractLocator returns something different than raw args AND it looks like a valid locator (quoted or #)
                 if (extractedFromArgs !== `"${method_args_raw}"` && (extractedFromArgs.startsWith('"') || extractedFromArgs.startsWith('\\#'))) {
                    locator_text = extractedFromArgs;
                    method_args_raw = ""; // Clear args as they were used as locator
                 }
            }


             // Argument Handling based on Python logic
             let reformatted_line = "";
             if (method_name_signature === "select_option()") { // Python: if method_name == "select_option()":
                 const args = method_args_raw.trim();
                 if (args.startsWith("[")) {
                     // Python: reformatted = f" {transformed_method} {locator_text} {args}" (Indentation added later)
                      reformatted_line = `${transformed_method}    ${locator_text}    ${args}`;
                 } else {
                     // Python: reformatted = f" Select options by {locator_text} Value {args}" (Indentation added later)
                     // Assuming "Select options by" should be the mapped keyword (transformed_method)
                     // Note: Python code has "Select options by" hardcoded, using transformed_method seems more flexible
                      reformatted_line = `${transformed_method}    ${locator_text}    Value    ${args}`;
                 }
             } else if (method_args_raw) {
                 // Python: cleaned_args = re.sub(r'^"(.*)"$', r'\1', method_args)
                 // Also handle single quotes
                 const cleaned_args = method_args_raw.replace(/^["'](.*)["']$/, '$1');
                  // Python: reformatted = f" {transformed_method} {locator_text} {cleaned_args}".strip() (Indentation added later)
                 reformatted_line = `${transformed_method}    ${locator_text}    ${cleaned_args}`.trim();
             } else {
                 // Python: reformatted = f" {transformed_method} {locator_text}".strip() (Indentation added later)
                 reformatted_line = `${transformed_method}    ${locator_text}`.trim();
             }
             // Add the formatted line without indentation (alignment handles it)
             testCaseLines.push(reformatted_line.replace(/^ */, '')); // Remove leading spaces if any

        } else {
             // Fallback for lines not matching the method pattern
             // Python: test_case_lines.append(" " + " ".join(parts)) -> Indents with 4 spaces + joins with spaces
             // Just join parts, alignment will handle indentation
             testCaseLines.push(commandParts.join('    '));
        }
    }

     // Add teardown based on Python logic
     if (contextCloseFound) {
        // Python adds Close Context and Close Browser
        testCaseLines.push("Close Context");
        testCaseLines.push("Close Browser");
     } else if (writingStarted && !firstGoto) { // Add default teardown if needed
        const lastStep = testCaseLines[testCaseLines.length - 1]?.trim();
         if (lastStep && !lastStep.startsWith('Close Context') && !lastStep.startsWith('Close Browser')) {
            testCaseLines.push("Close Context");
            testCaseLines.push("Close Browser");
        }
     }


    // Combine all sections based on Python structure
    const final_output = [
        ...outputLines, '', // Blank line separator
        ...variableLines, '', // Blank line separator
        ...testCaseLines
    ].join('\n');

    // Apply alignment as the last step, similar to Python calling align_robot_test_cases on the output file
    return alignRobotCode(final_output);
}


// --- Server Actions ---

// Action to get sheet names from an Excel file
interface SheetNameResult {
    success: boolean;
    sheetNames?: string[];
    error?: string;
}

export async function getSheetNames(formData: FormData): Promise<SheetNameResult> {
    const mappingFile = formData.get('mappingFile') as File | null;

    if (!mappingFile) {
        return { success: false, error: "Mapping file is missing." };
    }
    if (!mappingFile.name.endsWith('.xlsx')) {
        return { success: false, error: "Mapping file must be an .xlsx file." };
    }

    try {
        const fileBuffer = Buffer.from(await mappingFile.arrayBuffer());
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        return { success: true, sheetNames: workbook.SheetNames };
    } catch (error: any) {
        console.error(`Error reading sheet names from ${mappingFile.name}:`, error);
        return { success: false, error: `Failed to read sheets from ${mappingFile.name}: ${error.message}` };
    }
}


// --- Conversion Action ---

// Define Zod schema for FormData
const FileValidationSchema = zod.instanceof(File)
  .refine((file) => file.size > 0, { message: "File cannot be empty." });

const MappingFileSchema = FileValidationSchema
    .refine((file) => file.name.endsWith('.xlsx'), { message: "Mapping file must be an .xlsx file." });

const PythonFileSchema = FileValidationSchema
    .refine((file) => file.name.endsWith('.py'), { message: "Input file must be a Python (.py) file." });

// Updated schema to include selectedSheetName
const FormDataSchema = zod.object({
  mappingFile: MappingFileSchema,
  selectedSheetName: zod.string().min(1, 'A sheet name must be selected for the mapping file.'), // Added sheet name
  inputFiles: zod.union([PythonFileSchema, zod.array(PythonFileSchema).min(1, 'At least one input file is required.')]),
  isSingleFile: zod.string().transform(val => val === 'true').pipe(zod.boolean()),
});

// Type for the validated FormData structure
type ValidatedFormData = zod.infer<typeof FormDataSchema>;


interface ConversionResult {
  success: boolean;
  message?: string;
  error?: string;
  fileName?: string; // Suggested filename for download (.robot or .zip)
  fileContent?: string; // Actual content for single file download
  zipBuffer?: Buffer; // Buffer for zip file download
}


async function performConversion(data: ValidatedFormData): Promise<ConversionResult> {
    console.log("Starting conversion with validated data:", data);
    const { mappingFile, selectedSheetName, inputFiles, isSingleFile } = data;

    try {
        // 1. Load Mapping from File Buffer using the selected sheet name
        const mappingFileBuffer = Buffer.from(await mappingFile.arrayBuffer());
        const mapping = await loadMappingFromExcel(mappingFileBuffer, mappingFile.name, selectedSheetName); // Pass sheet name

        if (Object.keys(mapping).length === 0) {
             console.warn(`Mapping loaded from ${mappingFile.name} (Sheet: ${selectedSheetName}) resulted in an empty mapping dictionary.`);
             // Optionally return error: return { success: false, error: `Mapping from sheet "${selectedSheetName}" in "${mappingFile.name}" is empty or invalid. Check column names.` };
         }

        if (isSingleFile) {
             if (!(inputFiles instanceof File)) {
                return { success: false, error: 'Input is marked as single file, but multiple files were provided.' };
            }
            // --- Single File Conversion ---
            const inputFile = inputFiles;
            const inputFileName = inputFile.name;
            const outputBaseName = inputFileName.replace(/\.py$/, '');
            const outputFileName = `${outputBaseName}_converted.robot`;

            console.log(`Converting single file: ${inputFileName} using mapping from sheet: ${selectedSheetName}`);

            const pythonCodeBuffer = Buffer.from(await inputFile.arrayBuffer());
            const pythonCode = pythonCodeBuffer.toString('utf-8');
            // Use the translated conversion function
            const robotCode = convertSinglePlaywrightCode(pythonCode, mapping);

             return {
                 success: true,
                 message: `Successfully converted file ${inputFileName}. Output file is ready for download.`,
                 fileName: outputFileName,
                 fileContent: robotCode,
             };

        } else {
             if (!Array.isArray(inputFiles)) {
                 return { success: false, error: 'Input is marked as folder, but only a single file was provided.' };
             }
             // --- Folder Conversion ---
             const inputFolderFiles = inputFiles;
             const inputFolderName = inputFolderFiles[0]?.webkitRelativePath?.split('/')[0] || 'python_files';
             const outputBaseName = inputFolderName;
             const outputZipFileName = `${outputBaseName}_robot_files.zip`;

            console.log(`Converting folder (simulated): ${inputFolderName} using mapping from sheet: ${selectedSheetName}`);

            if (inputFolderFiles.length === 0) {
                return { success: false, error: `No Python (.py) files provided for folder conversion.` };
            }

             const zip = new AdmZip();

            for (const pyFile of inputFolderFiles) {
                 if (!pyFile.name.endsWith('.py')) {
                    console.warn(`Skipping non-python file in folder upload: ${pyFile.name}`);
                    continue;
                 }

                const inputFileBaseName = pyFile.name;
                const outputFileName = inputFileBaseName.replace(/\.py$/, '_converted.robot');

                try {
                    const pythonCodeBuffer = Buffer.from(await pyFile.arrayBuffer());
                    const pythonCode = pythonCodeBuffer.toString('utf-8');
                     // Use the translated conversion function
                    const robotCode = convertSinglePlaywrightCode(pythonCode, mapping);
                     zip.addFile(outputFileName, Buffer.from(robotCode, 'utf-8'));
                    console.log(`Converted and added to zip: ${inputFileBaseName} -> ${outputFileName}`);
                } catch (fileError: any) {
                    console.error(`Error converting file ${inputFileBaseName}: ${fileError.message}`);
                     // Add error file to zip for user feedback
                     const errorContent = `Failed to convert ${inputFileBaseName}:\n${fileError.stack || fileError.message}\n`;
                     zip.addFile(`${outputFileName}.ERROR.txt`, Buffer.from(errorContent, 'utf-8'));
                }
            }

            const zipBuffer = zip.toBuffer();
             console.log(`Created zip archive: ${outputZipFileName}`);


            return {
                success: true,
                message: `Successfully converted folder ${inputFolderName}. Output zip archive is ready for download.`,
                fileName: outputZipFileName,
                zipBuffer: zipBuffer,
            };
        }
    } catch (error: any) {
        console.error('Conversion process error:', error);
         let errorMessage = 'An unexpected server error occurred during conversion.';
         if (error instanceof Error) {
             errorMessage = `Conversion failed: ${error.message}`;
             if (error.stack) {
                 console.error("Stack Trace:", error.stack); // Log stack trace for debugging
                 // Avoid including full stack in user-facing error message in production
                 // errorMessage += `\nStack: ${error.stack}`;
             }
         }
         return { success: false, error: errorMessage };
    } finally {
        // Cleanup logic if needed
    }
}


// Server action now accepts FormData including the selected sheet name
export async function convertCode(formData: FormData): Promise<ConversionResult> {

     // --- Data Extraction from FormData ---
     const mappingFile = formData.get('mappingFile') as File | null;
     const selectedSheetName = formData.get('selectedSheetName') as string | null; // Get selected sheet name
     const isSingleFileValue = formData.get('isSingleFile') as string | null;
     const isSingleFile = isSingleFileValue === 'true';
     let inputFiles: File | File[] | null = null;

     if (isSingleFile) {
         inputFiles = formData.get('inputFileOrFolder') as File | null;
     } else {
         const allInputFiles = formData.getAll('inputFileOrFolder') as File[];
         // Filter out non-Python files before validation
         const pythonFiles = allInputFiles.filter(file => file.name.endsWith('.py'));
         inputFiles = pythonFiles.length > 0 ? pythonFiles : null;
         // Log if non-python files were filtered out
         if (pythonFiles.length < allInputFiles.length) {
             console.warn(`Filtered out ${allInputFiles.length - pythonFiles.length} non-Python files during folder upload.`);
         }
     }


     // --- Manual Basic Validation (Before Zod) ---
     if (!mappingFile) return { success: false, error: "Mapping file is missing." };
     if (!selectedSheetName) return { success: false, error: "Mapping sheet name is missing." }; // Validate sheet name presence
     if (!inputFiles) return { success: false, error: "Input Python file(s) are missing or folder contained no Python files." };
     if (isSingleFile && Array.isArray(inputFiles)) return { success: false, error: "Expected a single input file, but received multiple."};
     if (!isSingleFile && !Array.isArray(inputFiles)) return { success: false, error: "Expected multiple input files (folder), but received single."};


    // --- Zod Validation ---
    const dataToValidate = {
      mappingFile: mappingFile,
      selectedSheetName: selectedSheetName, // Add sheet name to validation object
      inputFiles: inputFiles, // Use the potentially filtered inputFiles list
      isSingleFile: isSingleFileValue || 'false', // Pass string for transform
    };


    const validationResult = FormDataSchema.safeParse(dataToValidate);

    if (!validationResult.success) {
       console.error("Server-side FormData validation failed:", validationResult.error.errors);
       const userFriendlyErrors = validationResult.error.errors.map(e => {
           const path = e.path.join('.');
           if (path === 'mappingFile') return 'Mapping file error: ' + e.message;
           if (path === 'selectedSheetName') return 'Sheet selection error: ' + e.message;
           if (path === 'inputFiles') return 'Input file/folder error: ' + e.message;
           return `${path}: ${e.message}`;
       }).join('; ');
       return { success: false, error: `Invalid input: ${userFriendlyErrors}` };
    }

    const validatedData = validationResult.data;

    // --- Perform Conversion ---
    try {
      const result = await performConversion(validatedData);
      return result;
    } catch (error) {
      console.error('Unexpected error in convertCode action:', error);
       let errorMessage = 'An unexpected server error occurred during conversion.';
        if (error instanceof Error) {
          errorMessage = error.message;
        }
      return { success: false, error: errorMessage };
    }
}
