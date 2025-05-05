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
    return method_name_with_parens.replace(/\(\)$/, ''); // Remove trailing ()
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
        // Extract the part after # and before the next quote or end of string
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

    // Fallback: return original wrapped in quotes if no pattern matches (Python logic)
    // This fallback might be problematic for RF.
     // console.warn(`Could not extract standard locator from: ${locator_text}. Returning quoted.`);
    return `"${locator_text}"`;
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
            // Python logic appended \n, so we trim and add \n to replicate
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
             // This handles the case before the first *** Test Cases *** header is encountered
             // The python code treats these as potential test case names.
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

     // Join lines. Note: Python logic adds \n to each formatted line, so join directly.
     // Need to remove potential double newlines at the end.
     let result = formattedLines.join('');
     // Remove trailing blank lines
     while (result.endsWith('\n\n')) {
         result = result.substring(0, result.length - 1);
     }

    return result;
}


/**
 * Converts a single Playwright Python script content to Robot Framework format.
 * (Translated from Python convert_playwright_code)
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
    let variableCounter = 1;
    let contextCloseFound = false;
    let insideTestCaseDefinition = false; // Track if we are inside a test case block (starts after a non-indented line in *** Test Cases ***)
    let currentTestCaseName = ""; // Store the current test case name

    const rawLines = inputCode.split("\n");
    let lines: string[] = [];

    // Pre-processing from Python logic for page.once
    // Replicate the specific replacement logic from the Python code
    rawLines.forEach(line => {
        const stripped = line.trim();
        if (stripped.startsWith("page.once")) {
             // Python code replaces any page.once line with these two lines
             lines.push('    ${promise} =       Promise To    Wait For Alert    action=accept   # text=<text content of alert box if you want to assert>');
             lines.push('    # <Line which triggers the alert action> ex click  <button>');
        } else {
            lines.push(line);
        }
    });


    let currentTestSteps: string[] = []; // Buffer for steps

    for (const line of lines) {
        const stripped_line = line.trim();

        if (!stripped_line || stripped_line.startsWith('#')) {
            continue; // Skip empty lines and comments
        }

         // Handle the specific 'dialog.dismiss()' case from Python
         // Note: The Python pre-processing already replaced page.once, so this specific check might be redundant
         // unless dismiss was handled differently. Let's keep it for closer adherence.
         // The python code looked for '.once("dialog", lambda dialog: dialog.dismiss())'
         // Let's assume the goal was to map dismiss actions differently.
         // Check if the original line (before pre-processing) contained dismiss
         const originalLineTrimmed = line.trim(); // Check original line
         if (originalLineTrimmed.includes('lambda dialog: dialog.dismiss()') && originalLineTrimmed.includes('.once("dialog"')) {
             // If the original line was a dismiss, we add the RF promise for dismiss
             // NOTE: The Python pre-processing replaced this line already. If we want dismiss,
             // we should modify the pre-processing. For now, adhering to the provided Python,
             // all page.once become 'accept'. Let's comment this out unless pre-processing is changed.
             // testCaseLines.push('    ${promise} =       Promise To    Wait For Alert    action=dismiss   # text=<text content>');
             // testCaseLines.push('    # <Line which triggers the alert action>');
             continue; // Skip further processing of this line as it was handled (or pre-processed)
         }


        // Handle context.close()
        if (stripped_line === "context.close()") {
            contextCloseFound = true;
            // Python code breaks here. Replicate that behavior.
            break;
        }

        // Handle expect() - Translated from Python logic
        if (stripped_line.startsWith("expect(")) {
            // Ensure we're writing steps (i.e., after the first goto or implicit start)
            if (!writingStarted && testCaseLines.length <= 1) {
                testCaseLines.push("Implicit Test Case"); // Start a default test case if expect appears first
                writingStarted = true; // Assume we start writing test steps now
                insideTestCaseDefinition = true;
            } else if (!writingStarted && testCaseLines.length > 1 && !insideTestCaseDefinition) {
                 // If we have a test case name but haven't started writing, mark as started
                 writingStarted = true;
                 insideTestCaseDefinition = true;
            }


            const variable_name = `\${var${variable_counter}}`; // Use ${} for RF vars
            variableCounter++;
            // Regex closer to Python's: expect(page.locator("selector")).to_contain_text("text")
            const locatorMatch = stripped_line.match(/locator\(['"]([^'"]+)['"]\)/); // Simpler regex from python code
            if (locatorMatch) {
                 let locator_text = locatorMatch[1];
                 // Python logic specific transformation: #id -> \#id
                 if (locator_text.startsWith("#")) {
                     locator_text = `\\#${locator_text.substring(1)}`; // Replicate Python's output
                 } else {
                     // If not #id, Python logic calls extract_locator which wraps in quotes or extracts name=""
                     locator_text = extractLocator(`.locator("${locator_text}")`); // Pass a construct it understands
                 }

                 // Python code uses 'Set Variable' and 'Wait For Elements State'
                 testCaseLines.push(`    ${variable_name}    Set Variable    ${locator_text}`); // RF variable setting
                 testCaseLines.push(`    Wait For Elements State    ${variable_name}    visible    timeout=10s`);

                // Python code uses 'Get Text' for assertion
                const expectedTextMatch = stripped_line.match(/to_contain_text\(['"]([^'"]+)['"]\)/);
                if (expectedTextMatch) {
                    const expected_text = expectedTextMatch[1];
                    testCaseLines.push(`    Get Text    ${variable_name}    ==    ${expected_text}`); // RF Get Text comparison
                }
            } else {
                // If locator extraction fails, add a comment
                testCaseLines.push(`    # TODO: Convert Playwright assertion: ${stripped_line}`);
            }
            continue; // Move to next line
        }

        // Handle page.goto() - Translated from Python logic
         // Python uses a simple regex: page\d*\.goto\("[^"]+"\)'
         const gotoMatch = stripped_line.match(/page\d*\.goto\(['"]([^'"]+)['"]\)/);
         if (gotoMatch) {
             writingStarted = true; // Start processing steps after the first goto
             const url = gotoMatch[1];

            if (firstGoto) {
                 // Python code adds "Test Case" name (no name extraction, just literal)
                 // It also adds Browser/Context/Page keywords
                 testCaseLines.push("Test Case"); // Literal "Test Case" name from Python logic
                 insideTestCaseDefinition = true; // We are now inside a test case definition
                 testCaseLines.push(`    New Browser        ${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'firefox'}        headless=False`); // Reference variable or default firefox
                 testCaseLines.push(`    New Context        viewport={'width': 1920, 'height': 1080}`); // Use RF dictionary syntax
                 // The page navigation URL comes from the variable mapping
                 let var_name = urlMapping[url];
                 if (!var_name) {
                     var_name = `\${URL${urlCounter}}`; // Use ${}
                     urlMapping[url] = var_name;
                     if (!variableLines.some(v => v.startsWith(var_name))) {
                        variableLines.push(`${var_name}    ${url}`);
                     }
                     urlCounter++;
                 }
                 testCaseLines.push(`    New Page            ${var_name}`); // Navigate using the variable
                 firstGoto = false;
            } else {
                 // Subsequent navigations use Go To
                 // Need to look up or create the variable for the URL
                 let var_name = urlMapping[url];
                 if (!var_name) {
                     var_name = `\${URL${urlCounter}}`;
                     urlMapping[url] = var_name;
                      if (!variableLines.some(v => v.startsWith(var_name))) {
                         variableLines.push(`${var_name}    ${url}`);
                      }
                     urlCounter++;
                 }
                 testCaseLines.push(`    Go To    ${var_name}`);
            }
            continue; // Move to next line
        }

        // If not writingStarted (i.e., before first goto or implicit start), skip other lines
        if (!writingStarted) {
            continue;
        }

        // Handle browser.close()
        if (stripped_line.startsWith("browser.close")) {
             testCaseLines.push("    Close Browser");
             writingStarted = false; // Stop processing further lines after browser close
             continue;
        }

        // General command processing - Translated from Python logic
        const parts = safeSplitOutsideQuotes(stripped_line, '.');
        const commandParts = parts.map(part => part.trim()).filter(part => part);

        if (commandParts.length < 1) {
            continue;
        }

         // Python logic: method is last part, locator_chain is parts[1:-1]
         const methodPart = commandParts[commandParts.length - 1];
         // Python assumes the object (page, context etc) is parts[0], skip it
         const locatorChainParts = commandParts.slice(1, -1); // Parts between object and method


        const methodMatch = methodPart.match(/^([a-zA-Z_]+)\((.*)\)$/);
        if (methodMatch) {
            const method_name_only = methodMatch[1];
            const method_name_signature = `${method_name_only}()`; // Signature for mapping lookup
            let method_args_raw = methodMatch[2]?.trim() ?? '';

            const transformed_method = findNearestMatch(method_name_signature, mapping);

             let locator_rf = "";
             if (locatorChainParts.length > 0) {
                 // Python joins with '><' and then extracts via regex r'<(.*)>'
                 const locatorChainStr = "<" + locatorChainParts.join("><") + ">";
                 const locatorMatch = locatorChainStr.match(/<(.*)>/);
                 if (locatorMatch) {
                    locator_rf = extractLocator(locatorMatch[1]); // Use translated extractLocator
                 }
             } else if (commandParts.length === 2 && commandParts[0].match(/^page\d*$/)) {
                // Handle direct page actions like page.click("selector") -> Click "selector"
                // Here, the selector is inside the method_args_raw
                 locator_rf = extractLocator(method_args_raw); // Extract locator from args
                 method_args_raw = ""; // Clear args as they were the locator
             } else if (commandParts.length > 1 && commandParts[0].match(/^page\d*$/)) {
                  // If no locator chain parts, but method has args, maybe the arg is the locator?
                  // Example: page.fill("input#id", "text") -> Fill Text    \#id    text
                  // Extract locator from the *first* argument if applicable
                  const firstArgMatch = method_args_raw.match(/^(['"])(.*?)\1(?:\s*,\s*(.*))?$/);
                   if (firstArgMatch) {
                       locator_rf = extractLocator(firstArgMatch[2]); // Use the first arg as locator
                       method_args_raw = firstArgMatch[3] ?? ""; // Keep remaining args
                   } else {
                        // Cannot determine locator, leave empty
                       // console.warn(`Could not determine locator for: ${stripped_line}`);
                   }
             }


             // Argument Handling based on Python logic
             let reformatted_line = "";
             if (method_name_signature === "select_option()") {
                 const args = method_args_raw.trim();
                 if (args.startsWith("[")) {
                     // Python formats as: Method Locator [arg1, arg2]
                      reformatted_line = `    ${transformed_method}    ${locator_rf}    ${args}`;
                 } else {
                     // Python formats as: Select options by Locator Value Arg
                     // Note: Python code had a typo "Select options by" should likely be mapped keyword
                     // Using transformed_method which should be the correct RF keyword from mapping
                      reformatted_line = `    ${transformed_method}    ${locator_rf}    Value    ${args}`;
                 }

             } else if (method_args_raw) {
                 // Generic argument cleaning (remove outer quotes) - From Python logic
                  const cleaned_args = method_args_raw.replace(/^['"](.*)['"]$/, '$1').replace(/^'(.*)'$/, '$1');
                  // Construct line: Method Locator Arg1 Arg2 ...
                   const argsArray = cleaned_args.split(/,\s*(?=(?:(?:[^"']*["']){2})*[^"']*$)/) // Basic split by comma, respecting quotes
                                       .map(arg => arg.trim().replace(/^['"](.*)['"]$/, '$1'));
                  reformatted_line = `    ${transformed_method}    ${locator_rf}    ${argsArray.join('    ')}`.trim();
             } else {
                 // Method without arguments
                 reformatted_line = `    ${transformed_method}    ${locator_rf}`.trim();
             }
             testCaseLines.push(reformatted_line);

        } else {
            // If the last part doesn't look like a method call, treat the whole line differently
             // Python logic joins parts with "    ": "        " + "    ".join(parts))
             testCaseLines.push(`    ${commandParts.join('    ')}`);
        }
    }

     // After processing all lines, add teardown if context.close() was found
     if (contextCloseFound) {
        // Check if we are inside a test case, otherwise add the teardown directly
        if (insideTestCaseDefinition || testCaseLines.length > 1) { // Check if any test case was started
             testCaseLines.push("    Close Context");
             // Close Browser is often implied by Close Context in RF Browser, but Python added both
             // testCaseLines.push("    Close Browser"); // Optional based on exact RF behavior desired
        } else {
             // This case shouldn't normally happen if context.close() is inside a test function
             // But if it appeared globally, add it outside test case structure (less common)
             console.warn("context.close() found outside of a detectable test case structure.");
             // Decide where to put it; maybe a separate keyword? For now, append to end.
             if (!testCaseLines.includes("    Close Context")) testCaseLines.push("    Close Context");
             // if (!testCaseLines.includes("    Close Browser")) testCaseLines.push("    Close Browser");
        }
     } else if (writingStarted && !firstGoto) {
         // If conversion started but context.close was not found, add default teardown
         const lastStep = testCaseLines[testCaseLines.length - 1]?.trim();
         if (lastStep && !lastStep.startsWith('Close Context') && !lastStep.startsWith('Close Browser')) {
            testCaseLines.push("    Close Context");
         }
     }


    // Combine all sections
    const final_output = [
        ...outputLines, '', // Blank line after Settings
        ...variableLines, '', // Blank line after Variables
        ...testCaseLines
    ].join('\n');

    // Align the final generated code
    // The python code calls align_robot_test_cases on the *output file*.
    // We simulate this by aligning the string content.
    return alignRobotCode(final_output); // Use the translated align function
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
                     zip.addFile(`${outputFileName}.ERROR.txt`, Buffer.from(`Failed to convert ${inputFileBaseName}: ${fileError.message}\n`, 'utf-8'));
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
        return { success: false, error: `Conversion failed: ${error.message}` };
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
      isSingleFile: isSingleFileValue || 'false',
    };


    const validationResult = FormDataSchema.safeParse(dataToValidate);

    if (!validationResult.success) {
       console.error("Server-side FormData validation failed:", validationResult.error.errors);
       const userFriendlyErrors = validationResult.error.errors.map(e => {
           if (e.path.includes('mappingFile')) return 'Mapping file error.';
           if (e.path.includes('selectedSheetName')) return 'Please select a sheet from the mapping file.'; // Specific error for sheet
           if (e.path.includes('inputFiles')) return 'Input file/folder error.';
           return `${e.path.join('.')}: ${e.message}`;
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
