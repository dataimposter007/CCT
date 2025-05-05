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
    // If no match found, return the original method name without parentheses
    // console.warn(`No matching keyword found for ${method_name_with_parens} in mapping. Using base name.`);
    // Python logic returned the method name with parens, replicating that first
    // return method_name_with_parens.replace(/\(\)$/, ''); // Remove trailing ()
    return method_name_with_parens; // Return original with parens as per python logic
}


/**
 * Extracts a locator string suitable for Robot Framework from Playwright locator text.
 * (Translated from Python extract_locator using RegExp)
 * @param locator_text The raw locator text from Playwright code (e.g., 'locator("#myId")', 'get_by_role("button", name="Submit")').
 * @returns A formatted locator string (e.g., "id=myId", '"Submit"', '"some text"').
 */
function extractLocator(locator_text: string): string {
    // Handle ID selectors: locator("#myId") -> \#myId (Python logic used \# prefix)
    // RF usually uses id=myId, but the Python logic returns \#myId, so we replicate that for now.
    if (locator_text.includes('#')) {
        const match = locator_text.match(/#([^"']+)/);
        if (match) {
            return `\\#${match[1]}`; // Replicate Python's output: \#someId
        }
    }

    // Handle name attributes: get_by_role("...", name="Submit") -> "Submit" (Python logic)
    let match = locator_text.match(/name\s*=\s*["']([^"']+)["']/);
    if (match) {
        return `"${match[1]}"`; // Return just the name value in quotes
    }

    // Handle simple quoted strings: locator("text") -> "text" (Python logic)
    match = locator_text.match(/\(\s*["']([^"']+)["']\s*\)/);
     if (match) {
         return `"${match[1]}"`; // Return the content within quotes
     }

    // Fallback: return original text (Python logic returned locator_text, not wrapped in quotes)
     // console.warn(`Could not extract standard locator from: ${locator_text}. Returning original.`);
    return locator_text;
}

/**
 * Aligns Robot Framework test case steps with standard indentation.
 * (Translated from Python align_robot_test_cases)
 * @param inputContent The raw content of the .robot file.
 * @returns Formatted content string.
 */
function alignRobotCode(inputContent: string): string {
    const lines = inputContent.split('\n');
    const formattedLines: string[] = [];
    let insideTestCase = false;
    let insideVariables = false;
    let insideSettings = false; // Added to handle Settings section if needed
    const testCaseIndent = '    '; // 4 spaces for steps

    for (const line of lines) {
        const strippedLine = line.trim();

        // Detect section headers
        if (strippedLine.startsWith('***') && strippedLine.endsWith('***')) {
            formattedLines.push(line); // Keep original line spacing for headers
            insideTestCase = strippedLine.toUpperCase().includes('TEST CASES');
            insideVariables = strippedLine.toUpperCase().includes('VARIABLES');
            insideSettings = strippedLine.toUpperCase().includes('SETTINGS'); // Track settings
            continue;
        }

        // Skip blank lines and comments (preserve original line)
        if (!strippedLine || strippedLine.startsWith('#')) {
            formattedLines.push(line);
            continue;
        }

        // Apply indentation logic based on Python script's target format
        if (insideVariables || insideSettings) {
            // Variables/Settings: Keep original line (likely already aligned or single keyword)
             formattedLines.push(`${strippedLine}\n`);
        } else if (insideTestCase) {
            // Test Cases: Indent steps with 4 spaces, keep test case names non-indented
            if (line.match(/^\S/) && !strippedLine.startsWith(testCaseIndent) && !strippedLine.startsWith('***')) {
                // This looks like a Test Case Name (starts with non-space, not already indented)
                formattedLines.push(`${strippedLine}\n`); // Keep test case name aligned left
            } else if (strippedLine) {
                // This is likely a step, indent it
                formattedLines.push(`${testCaseIndent}${strippedLine}\n`);
            } else {
                 formattedLines.push(line); // Preserve spacing for potentially blank lines within test case
            }
        } else {
             // If somehow outside known sections, preserve original line
             if (strippedLine.startsWith('***')) {
                  formattedLines.push(line); // Preserve other section headers
             } else if (strippedLine) {
                 // Assume it's a test case name if before the actual section
                 formattedLines.push(`${strippedLine}\n`);
                 insideTestCase = true; // Assume we've entered test cases implicitly
             } else {
                 formattedLines.push(line); // Preserve blank lines
             }
        }
    }

     let result = formattedLines.join('');
     while (result.endsWith('\n\n')) {
         result = result.substring(0, result.length - 1);
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
    let insideTestCaseDefinition = false; // Track if we are inside a test case block

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

        // Handle dismiss alert (based on Python comment logic)
        // Note: Python pre-processing already replaces page.once lines.
        // The Python code had a specific check for `lambda dialog: dialog.dismiss()` within `.once("dialog"`,
        // but the replacement logic uses 'action=accept'. To strictly follow the provided Python code's *effective* behavior
        // (where all page.once becomes accept), we don't need a separate dismiss case here.
        // If the intent was different, the pre-processing should be adjusted.
        // Example: if originalLineTrimmed.includes('lambda dialog: dialog.dismiss()') ...

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
                 testCaseLines.push(`    ${variable_name}    Set Variable    ${locator_text}`);
                 testCaseLines.push(`    Wait For Elements State    ${variable_name}    visible    timeout=10s`);

                // Python regex: r'to_contain_text\("([^"]+)"\)'
                const expectedTextMatch = stripped_line.match(/to_contain_text\("([^"]+)"\)/);
                if (expectedTextMatch) {
                    const expected_text = expectedTextMatch[1];
                     // Python uses 'Get Text' keyword for assertion:
                    testCaseLines.push(`    Get Text    ${variable_name}    ==    ${expected_text}`); // Using '==' for assertion based on RF common practice
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
                 insideTestCaseDefinition = true;
                 // Python line: "New Browser ${BROWSER} headless=False timeout=60000 slowMo=0:00:01"
                 // RF Browser doesn't directly support slowMo like this, using standard keywords.
                 testCaseLines.push(`    New Browser        ${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'firefox'}        headless=False`);
                 // Python line: "New Context viewport={'width': 1920, 'height': 1080}"
                 testCaseLines.push(`    New Context        viewport={'width': 1920, 'height': 1080}`);
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
                 testCaseLines.push(`    New Page            ${var_name}`);
                 firstGoto = false;
             } else {
                // Subsequent navigations just use "Go To" in Python script (implicitly)
                // The Python code doesn't explicitly show `Go To` for subsequent URLs, it seems to rely
                // on the URL variable mapping. Replicating the variable lookup.
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
                 testCaseLines.push(`    Go To    ${var_name}`);
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
             testCaseLines.push("    Close Browser");
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
         const locatorChainParts = commandParts.slice(1, -1); // Python: locator_chain = parts[1:-1]

         // Python regex: r'([a-zA-Z_]+)\((.*)\)'
        const methodMatch = methodPart.match(/^([a-zA-Z_]+)\((.*)\)$/);
        if (methodMatch) {
            const method_name_only = methodMatch[1];
            const method_name_signature = `${method_name_only}()`; // Python: method_name = method_match.group(1) + "()"
            let method_args_raw = methodMatch[2]?.trim() ?? ''; // Python: method_args = method_match.group(2)

            const transformed_method = findNearestMatch(method_name_signature, mapping); // Python: transformed_method = find_nearest_match(...)

            // Locator extraction based on Python logic
            let locator_text = "";
            if (locatorChainParts.length > 0) {
                // Python: locator_text = "<" + "><".join(locator_chain) + ">"
                const joined_chain = "<" + locatorChainParts.join("><") + ">";
                // Python: locator_text = re.search(r'<(.*)>', locator_text).group(1)
                 const chainMatch = joined_chain.match(/<(.*)>/);
                 if (chainMatch) {
                     locator_text = extractLocator(chainMatch[1]); // Python: locator_text = extract_locator(locator_text)
                 }
            } else {
                // If no chain, Python logic implicitly uses args as locator in some cases (like page.click("selector"))
                // This part is less explicit in the python code, but extractLocator handles cases like `("selector")`
                locator_text = extractLocator(method_args_raw);
                // If args were used as locator, clear them? Python doesn't explicitly show this, but it's implied.
                 if (locator_text !== method_args_raw) { // Check if extractLocator actually extracted something different
                     method_args_raw = ""; // Clear args if they were interpreted as a locator
                 }
            }


             // Argument Handling based on Python logic
             let reformatted_line = "";
             if (method_name_signature === "select_option()") { // Python: if method_name == "select_option()":
                 const args = method_args_raw.trim();
                 if (args.startsWith("[")) {
                     // Python: reformatted = f" {transformed_method} {locator_text} {args}" (Indentation added later)
                      reformatted_line = `    ${transformed_method}    ${locator_text}    ${args}`;
                 } else {
                     // Python: reformatted = f" Select options by {locator_text} Value {args}" (Indentation added later)
                     // Assuming "Select options by" should be the mapped keyword (transformed_method)
                      reformatted_line = `    ${transformed_method}    ${locator_text}    Value    ${args}`;
                 }
             } else if (method_args_raw) {
                 // Python: cleaned_args = re.sub(r'^"(.*)"$', r'\1', method_args)
                 const cleaned_args = method_args_raw.replace(/^["'](.*)["']$/, '$1');
                  // Python: reformatted = f" {transformed_method} {locator_text} {cleaned_args}".strip() (Indentation added later)
                 reformatted_line = `    ${transformed_method}    ${locator_text}    ${cleaned_args}`.trim();
             } else {
                 // Python: reformatted = f" {transformed_method} {locator_text}".strip() (Indentation added later)
                 reformatted_line = `    ${transformed_method}    ${locator_text}`.trim();
             }
             // Add the formatted line with proper indentation
             testCaseLines.push(reformatted_line); // Python appends to test_case_lines

        } else {
             // Python: test_case_lines.append(" " + " ".join(parts)) -> Seems like 4 spaces + 4 spaces join
             // Replicating the likely intended Robot Framework structure: Keyword Arg1 Arg2 ...
             testCaseLines.push(`    ${commandParts.join('    ')}`);
        }
    }

     // Add teardown based on Python logic
     if (contextCloseFound) {
        // Python adds Close Context and Close Browser
        testCaseLines.push("    Close Context");
        testCaseLines.push("    Close Browser");
     } else if (writingStarted && !firstGoto) { // Add default teardown if needed
        const lastStep = testCaseLines[testCaseLines.length - 1]?.trim();
         if (lastStep && !lastStep.startsWith('Close Context') && !lastStep.startsWith('Close Browser')) {
            testCaseLines.push("    Close Context");
            // Close Browser is often added in Python too, replicating
            testCaseLines.push("    Close Browser");
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
                 errorMessage += `\nStack: ${error.stack}`; // Optionally include stack in error message (be cautious in production)
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
         inputFiles = allInputFiles.length > 0 ? allInputFiles : null;
     }


     // --- Manual Basic Validation (Before Zod) ---
     if (!mappingFile) return { success: false, error: "Mapping file is missing." };
     if (!selectedSheetName) return { success: false, error: "Mapping sheet name is missing." }; // Validate sheet name presence
     if (!inputFiles) return { success: false, error: "Input file(s) are missing." };
     if (isSingleFile && Array.isArray(inputFiles)) return { success: false, error: "Expected a single input file, but received multiple."};
     if (!isSingleFile && !Array.isArray(inputFiles)) return { success: false, error: "Expected multiple input files (folder), but received single."};


    // --- Zod Validation ---
    const dataToValidate = {
      mappingFile: mappingFile,
      selectedSheetName: selectedSheetName, // Add sheet name to validation object
      inputFiles: inputFiles,
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
