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
        }>(worksheet);

        const mapping: { [key: string]: string } = {};
        jsonData.forEach(row => {
            // Convert to string and trim, handle potential undefined/null
            const playwrightMethod = String(row.Actual_core_python_playwright_methods ?? '').trim();
            const robotKeyword = String(row.browser_library_keyword ?? '').trim();

            // Ensure both values are non-empty after conversion
            if (playwrightMethod && robotKeyword) {
                mapping[playwrightMethod] = robotKeyword;
            } else {
                // Optionally log rows that were skipped due to missing data
                // console.log('Skipping row due to missing data:', row);
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
 * @param method_name The Playwright method signature (e.g., "click()"). Must include '()'
 * @param mapping The mapping dictionary.
 * @returns The corresponding Robot keyword or the original method name (without '()') if no match found.
 */
function findNearestMatch(method_name_with_parens: string, mapping: { [key: string]: string }): string {
    // Ensure the input has parentheses for matching keys like 'locator(...).click()'
    // const method_name_with_parens = method_name.endsWith('()') ? method_name : `${method_name}()`;

    for (const key in mapping) {
        // Check if key is a string and method_name is a substring of the key
        if (typeof key === 'string' && key.includes(method_name_with_parens)) {
             return mapping[key]; // Return the mapped Robot keyword
        }
    }
    // If no match found, return the original method name without parentheses
    console.warn(`No matching keyword found for ${method_name_with_parens} in mapping. Using base name.`);
    return method_name_with_parens.replace(/\(\)$/, '');
}


/**
 * Extracts a locator string suitable for Robot Framework from Playwright locator text.
 * (Translated from Python extract_locator using RegExp)
 * @param locator_text The raw locator text from Playwright code (e.g., 'locator("#myId")', 'get_by_role("button", name="Submit")').
 * @returns A formatted locator string (e.g., "id=myId", '"Submit"', '"some text"').
 */
function extractLocator(locator_text: string): string {
    // Handle ID selectors: locator("#myId") -> id=myId (Python used \#, RF needs id=)
    if (locator_text.includes('#')) {
        const parts = locator_text.split('#');
        const idPart = parts[parts.length - 1].split('"')[0].split("'")[0]; // Handle both quote types
        if (idPart) return `id=${idPart}`;
    }

    // Handle name attributes: get_by_role("...", name="Submit") -> "Submit" (Python logic)
    // RF often needs more context, e.g., role=button[name="Submit"]
    // Let's refine this based on common RF Browser Library selectors
    let match = locator_text.match(/get_by_role\s*\(\s*["']([^"']+)["']\s*,\s*.*?name\s*=\s*["']([^"']+)["']\s*\)/);
    if (match) {
        return `role=${match[1]}[name="${match[2]}"]`; // More specific RF selector
    }
     // Simpler name match if not in get_by_role
     match = locator_text.match(/name\s*=\s*["']([^"']+)["']/);
     if (match) {
         // Returning just the name might be insufficient for RF, depends on context.
         // Let's try a css attribute selector as a guess.
         return `css=[name="${match[1]}"]`;
     }


    // Handle simple quoted strings: locator("text") -> "text" (Python logic)
    // RF usually needs a strategy, e.g., text="text" or css="text"
    match = locator_text.match(/\(\s*["']([^"']+)["']\s*\)/);
     if (match && !locator_text.includes('get_by_') && !locator_text.includes('.locator(')) {
         // If it's just page("something"), maybe it's not a standard Playwright locator?
         // Or if it's locator("css=button"), extract appropriately.
          match = locator_text.match(/\(\s*["'](css=|xpath=|id=|text=|!)([^"']+)["']\s*\)/);
          if (match) {
              return `${match[1]}${match[2]}`; // Use explicit strategy if present
          } else {
              // Re-match for just the content if no strategy prefix
              match = locator_text.match(/\(\s*["']([^"']+)["']\s*\)/);
              if (match) {
                 // Default to CSS or text based on content
                 const content = match[1];
                 if (content.includes('/') || content.includes('[')) return `xpath=${content}`;
                 if (content.includes('.') || content.includes('#') || content.includes('>')) return `css=${content}`;
                 return `text=${content}`; // Default to text if unsure
              }
          }
     } else if (match) { // Handle cases like get_by_text("Login")
         const strategyMatch = locator_text.match(/get_by_([a-zA-Z]+)\s*\(\s*["']([^"']+)["']\s*\)/);
         if (strategyMatch) {
             const strategy = strategyMatch[1].toLowerCase();
             const value = strategyMatch[2];
             // Map Playwright get_by strategies to RF Browser strategies
             if (strategy === 'text') return `text=${value}`;
             if (strategy === 'label') return `label=${value}`;
             if (strategy === 'placeholder') return `placeholder=${value}`;
             if (strategy === 'title') return `title=${value}`;
             if (strategy === 'testid') return `data-testid=${value}`;
             // Add other get_by mappings if needed
             return `${strategy}=${value}`; // Fallback
         }
         // Fallback for the general quoted string case if not get_by_*
         return `"${match[1]}"`; // Original Python logic's fallback
     }


    // Fallback: return original wrapped in quotes if no pattern matches
     // This fallback might be problematic for RF, try to provide a default strategy
     console.warn(`Could not determine explicit locator strategy for: ${locator_text}. Defaulting to 'css=${locator_text}'`);
     return `css=${locator_text}`; // Default to CSS strategy as a last resort
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
    let inTestCaseSection = false; // Combined flag for Test Cases / Keywords
    let inVariablesSection = false;
    let inSettingsSection = false;
    const indent = '    '; // 4 spaces

    for (const line of lines) {
        const strippedLine = line.trim();

        // Detect section headers
        if (strippedLine.startsWith('***') && strippedLine.endsWith('***')) {
            formattedLines.push(strippedLine); // Keep section header trimmed
             inTestCaseSection = strippedLine.toUpperCase().includes('TEST CASES') || strippedLine.toUpperCase().includes('KEYWORDS');
             inVariablesSection = strippedLine.toUpperCase().includes('VARIABLES');
             inSettingsSection = strippedLine.toUpperCase().includes('SETTINGS');

            // Add blank line before new section if the previous line wasn't blank or another header
            if (formattedLines.length > 1 && formattedLines[formattedLines.length - 2].trim() !== '' && !formattedLines[formattedLines.length - 2].trim().startsWith('***')) {
                formattedLines.splice(formattedLines.length - 1, 0, ''); // Insert blank line before the header
            }
            continue;
        }

        // Handle blank lines and comments
        if (!strippedLine || strippedLine.startsWith('#')) {
            formattedLines.push(line); // Preserve original line
            continue;
        }

        // Apply indentation logic based on Python script
        if (inSettingsSection || inVariablesSection) {
            // Settings/Variables: Usually 2 spaces for items, but 0 for section content like Library/Resource
            if (line.match(/^\S/) || line.trim().split(/\s{2,}/).length > 1) { // Starts with non-space or has multiple space separation
                 formattedLines.push(line.trim()); // Keep alignement for multi-part lines (e.g., Library    Browser) or no indent needed
            } else {
                 formattedLines.push(`  ${strippedLine}`); // Add 2 spaces if it was indented originally but not multi-part
            }
        } else if (inTestCaseSection) {
            // Test Cases/Keywords: 4 spaces for steps, 0 for test/keyword name
             if (line.match(/^\S/) && !line.startsWith(indent)) { // Line starts with non-space and isn't already indented
                // This is likely a Test Case or Keyword name
                 formattedLines.push(strippedLine);
                 // Add a blank line before a new test case/keyword name if needed
                 if (formattedLines.length > 1 && formattedLines[formattedLines.length - 2].trim() !== '' && !formattedLines[formattedLines.length - 2].trim().startsWith('***')) {
                    formattedLines.splice(formattedLines.length - 1, 0, '');
                 }

            } else {
                // This is a step, ensure 4-space indentation
                formattedLines.push(`${indent}${strippedLine}`);
            }
        } else {
            // Outside known sections, keep original line for safety
            formattedLines.push(line);
        }
    }

    // Final pass to clean up excessive blank lines
    const finalLines: string[] = [];
    let consecutiveBlankLines = 0;
    for (const line of formattedLines) {
        if (line.trim() === '') {
            consecutiveBlankLines++;
            if (consecutiveBlankLines <= 1) { // Allow only one blank line
                finalLines.push(line);
            }
        } else {
            consecutiveBlankLines = 0;
            finalLines.push(line);
        }
    }

    // Ensure there's a newline at the end
    if (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() !== '') {
        finalLines.push('');
    }


    return finalLines.join('\n');
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
    let firstGoto = true; // Reset per test case if multiple test cases are detected
    let variableCounter = 1;
    let contextCloseFound = false;
    let insideTestCaseDefinition = false; // Track if we are processing lines within a test case
    let currentTestCaseName = "Default Test Case"; // Placeholder

    const rawLines = inputCode.split("\n");
    let lines: string[] = [];

    // Pre-processing from Python logic for page.once
    rawLines.forEach(line => {
         const stripped = line.trim();
         // Simplified handling for page.once based on Python example's replacement
         if (stripped.startsWith("page.once('dialog', lambda dialog: dialog.dismiss())")) {
             // This exact line was replaced by the promise lines in the python code, replicate that.
             lines.push('    ${promise} =       Promise To    Wait For Alert    action=dismiss   # text=<text content of alert box if you want to assert>');
             lines.push('    # <Line which triggers the alert action> ex click  <button>');
         } else if (stripped.startsWith("page.once")) { // Catch other page.once? Assume accept
             lines.push('    ${promise} =       Promise To    Wait For Alert    action=accept   # text=<text content of alert box if you want to assert>');
             lines.push('    # <Line which triggers the alert action> ex click  <button>');
         }
          else {
            lines.push(line);
        }
    });

    let currentTestSteps: string[] = []; // Buffer for steps of the current test case

    for (const line of lines) {
        const stripped_line = line.trim();

        // Detect test case definition (simple heuristic)
        if (stripped_line.startsWith('def test_')) {
             const match = stripped_line.match(/def (test_\w+)\(/);
             if (match) {
                // If we were already in a test case, finalize it
                 if (insideTestCaseDefinition && currentTestSteps.length > 0) {
                     testCaseLines.push(currentTestCaseName);
                     testCaseLines.push(...currentTestSteps);
                     testCaseLines.push(''); // Add blank line after test case
                 }
                 // Start new test case
                 currentTestCaseName = match[1].replace(/_/g, ' ').replace(/^test /i, '').replace(/\b\w/g, l => l.toUpperCase()); // Format name
                 currentTestSteps = []; // Reset steps
                 insideTestCaseDefinition = true;
                 firstGoto = true; // Reset for the new test case
                 writingStarted = false; // Reset writing started flag
                 contextCloseFound = false; // Reset context close flag
             }
            continue; // Skip the def line itself
        }


        // Skip lines if not inside a test definition
        if (!insideTestCaseDefinition) {
            continue;
        }

        if (!stripped_line || stripped_line.startsWith('#')) {
            continue; // Skip empty lines and comments
        }

        // Handle specific lines from Python logic
        if (stripped_line === "context.close()") {
            contextCloseFound = true;
             // Don't break, might be more lines. The teardown is added at the end.
             continue;
        }
         if (stripped_line === "browser.close()") {
            // If context.close() was also found, Close Browser is implicitly handled by RF's Close Context
             if (!contextCloseFound) {
                currentTestSteps.push("    Close Browser");
             }
            writingStarted = false; // Stop processing further lines after browser close typically
             continue; // Or break if needed
         }


        // Handle expect() - Translated from Python logic
        if (stripped_line.startsWith("expect(")) {
            const variable_name = `\${var${variable_counter}}`; // Use ${} for RF vars
            variableCounter++;
            // Regex closer to Python's: expect(page.locator("selector")).to_contain_text("text")
            const locatorMatch = stripped_line.match(/expect\(.*?\.locator\(['"]([^'"]+)['"]\)\)/);
            if (locatorMatch) {
                 let locator_text = locatorMatch[1];
                 // Python logic specific transformation: #id -> id=id
                 if (locator_text.startsWith("#")) {
                     locator_text = `id=${locator_text.substring(1)}`;
                 } else {
                     // Use the more general extractLocator for other cases
                     locator_text = extractLocator(`.locator("${locator_text}")`); // Pass a construct it understands
                 }

                 currentTestSteps.push(`    ${variable_name} =    Set Variable    ${locator_text}`); // RF variable setting
                 currentTestSteps.push(`    Wait For Elements State    ${variable_name}    visible    timeout=10s`);

                const expectedTextMatch = stripped_line.match(/\.to_contain_text\(['"]([^'"]+)['"]\)/);
                if (expectedTextMatch) {
                    const expected_text = expectedTextMatch[1];
                     // Use RF's keyword for checking text, e.g., Page Should Contain Element + Element Text Should Be
                     // Using Get Text and comparing is also an option like the python code, but less idiomatic RF
                     // Let's use a more direct RF assertion:
                     currentTestSteps.push(`    Element Text Should Be    ${variable_name}    ${expected_text}`);
                     // Alternative: Check if page contains the text within the element
                     // currentTestSteps.push(`    Page Should Contain Element ${variable_name}    ${expected_text}`);
                }
            } else {
                // Handle other expect variations if needed
                currentTestSteps.push(`    # TODO: Convert Playwright assertion: ${stripped_line}`);
            }
            continue; // Move to next line
        }

        // Handle page.goto() - Translated from Python logic
         // Use a more flexible regex to catch variations page.goto, page1.goto etc.
         if (stripped_line.match(/\.goto\(['"]([^'"]+)['"]\)/)) {
             writingStarted = true; // Start processing steps after the first goto
             const url_match = stripped_line.match(/\(['"]([^'"]+)['"]\)/);
             if (url_match) {
                 const url = url_match[1];
                 let var_name = urlMapping[url];
                 if (!var_name) {
                     var_name = `\${URL${urlCounter}}`; // Use ${}
                     urlMapping[url] = var_name;
                     // Add to variableLines only if not already there
                     if (!variableLines.some(v => v.startsWith(var_name))) {
                        variableLines.push(`${var_name}    ${url}`);
                     }
                     urlCounter++;
                 }

                if (firstGoto) {
                    // Add setup steps based on Python logic for the first goto in a test case
                     // No "Test Case" line needed here, RF structure handles it
                     currentTestSteps.push(`    New Browser    browser=${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'firefox'}    headless=False`); // Reference variable if defined, default firefox
                     currentTestSteps.push(`    New Context    viewport={'width': 1920, 'height': 1080}`); // Use RF dictionary syntax
                     currentTestSteps.push(`    New Page    ${var_name}`); // Navigate
                    firstGoto = false;
                } else {
                    // Subsequent navigations use Go To
                    currentTestSteps.push(`    Go To    ${var_name}`);
                }
            }
            continue; // Move to next line
        }


        // If not writingStarted (i.e., before first goto), skip other lines
        if (!writingStarted) {
            continue;
        }


        // General command processing - Translated from Python logic
        const parts = safeSplitOutsideQuotes(stripped_line, '.');
        const commandParts = parts.map(part => part.trim()).filter(part => part);

        if (commandParts.length < 1) { // Should have at least 'page.method()' or similar
            continue;
        }

         // Python logic seems to assume structure like: page.locator(...).action()
         // Let's adapt it. Identify the action (last part) and the locator chain (parts before action)
         let actionPart = commandParts[commandParts.length - 1];
         let locatorChainStr = commandParts.slice(0, -1).join('.'); // Reconstruct chain for locator extraction


        const methodMatch = actionPart.match(/^([a-zA-Z_]+)\((.*)\)$/);
        if (methodMatch) {
            const method_name_only = methodMatch[1];
            const method_name_signature = `${method_name_only}()`; // Signature for mapping
            let method_args_raw = methodMatch[2]?.trim() ?? '';

            const transformed_method = findNearestMatch(method_name_signature, mapping);

             let locator_rf = "";
             if (locatorChainStr) {
                 // Use extractLocator on the reconstructed chain
                 locator_rf = extractLocator(locatorChainStr);
             } else if (transformed_method !== 'New Page' && transformed_method !== 'Go To' && !['Close Browser', 'Close Context', 'Promise To', 'Wait For Alert'].includes(transformed_method)) {
                 // If no locator chain but the action likely needs one
                 console.warn(`Action '${transformed_method}' used without a preceding locator in line: ${stripped_line}. Check Robot syntax.`);
                 // RF keywords like 'Click' often require a locator argument.
                 // We cannot assume 'body' like in the previous version. Leave locator empty.
             }


             // Argument Handling based on Python logic
             let finalArgs: string[] = [];
             if (method_name_signature === "select_option()") {
                 const args = method_args_raw.trim();
                 // Python logic special handling for select_option
                 if (args.startsWith("[")) { // Looks like list of values/labels/indices
                     // RF 'Select Options By' needs strategy (label, value, index)
                     // Defaulting to 'label' based on Playwright common use. Adjust if needed.
                     // Assuming args is like '["Option 1", "Option 2"]'
                     const options = JSON.parse(args.replace(/'/g, '"')); // Parse Python list string
                      finalArgs.push('label');
                      finalArgs.push(...options.map((opt: string) => `"${opt}"`)); // Quote each option for RF

                 } else {
                     // Assumes single value/label like 'value_to_select'
                      // Defaulting to 'value' strategy here.
                      finalArgs.push('value');
                      finalArgs.push(args); // Pass the raw argument
                 }
                 // Override the method name based on the refined logic
                 // The findNearestMatch might return something generic, but we need Select Options By
                 const selectMethod = 'Select Options By'; // Correct RF keyword
                 currentTestSteps.push(`    ${selectMethod}    ${locator_rf}    ${finalArgs.join('    ')}`);

             } else if (method_args_raw) {
                 // Generic argument cleaning (remove outer quotes) - From Python logic
                 // This might be too simplistic for complex arguments.
                  const cleaned_args = method_args_raw.replace(/^['"](.*)['"]$/, '$1');
                  finalArgs.push(cleaned_args);
                  currentTestSteps.push(`    ${transformed_method}    ${locator_rf}    ${finalArgs.join('    ')}`.trim());
             } else {
                 // Method without arguments
                 currentTestSteps.push(`    ${transformed_method}    ${locator_rf}`.trim());
             }

        } else {
            // If the last part doesn't look like a method call, treat the whole line differently
             // Python logic appends "        " + "    ".join(parts) - this seems incorrect for RF.
             // Let's add a comment indicating it couldn't be parsed as an action.
            currentTestSteps.push(`    # INFO: Could not parse line as standard Playwright action: ${stripped_line}`);
        }
    }

     // After processing all lines, finalize the last test case
     if (insideTestCaseDefinition && currentTestSteps.length > 0) {
         testCaseLines.push(currentTestCaseName);
         // Add teardown based on Python logic (Close Context/Browser)
         if (contextCloseFound) {
             // Check if Close Context or Close Browser is already the last step
             const lastStep = currentTestSteps[currentTestSteps.length - 1]?.trim();
             if (lastStep !== 'Close Context' && lastStep !== 'Close Browser') {
                currentTestSteps.push("    Close Context");
                // Close Browser is implied by Close Context in RF Browser Library usually
             }
         } else if (writingStarted && !firstGoto) { // Add default teardown if a test ran but no explicit close was found
             const lastStep = currentTestSteps[currentTestSteps.length - 1]?.trim();
             if (lastStep !== 'Close Context' && lastStep !== 'Close Browser') {
                 currentTestSteps.push("    Close Context");
             }
         }
         testCaseLines.push(...currentTestSteps);
         testCaseLines.push(''); // Add blank line
     } else if (testCaseLines.length === 1) { // Only "*** Test Cases ***" header exists
        // If no test cases were found or processed, add a comment
        testCaseLines.push("# No 'def test_' functions found or processed in the input file.");
     }


    // Combine all sections
    const final_output = [
        ...outputLines, '', // Blank line after Settings
        ...variableLines, '', // Blank line after Variables
        ...testCaseLines
    ].join('\n');

    // Align the final generated code
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
