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
    // Python code checks `method_name in key`, meaning the method name (like 'click()') should be a substring of the key in the mapping dict.
    for (const key in mapping) {
        if (typeof key === 'string' && key.includes(method_name_with_parens)) {
            return mapping[key]; // Return the mapped Robot keyword
        }
    }
    // Python code returns the original method name (without parens if they exist) if no match found.
    // Example: if 'click()' is not found, it might return 'click' based on the Python logic implicitly.
    return method_name_with_parens.replace(/\(\)$/, '');
}


/**
 * Extracts a locator string suitable for Robot Framework from Playwright locator text.
 * Handles specific Playwright patterns like #id, name="value", and ("value").
 * (Translated from Python extract_locator)
 * @param locator_text The raw locator text from Playwright code (e.g., 'locator("#myId")', 'get_by_role("button", name="Submit")', 'page.locator("text=Submit")').
 * @returns A formatted locator string (e.g., "\\#myId", '"Submit"', '"text=Submit"').
 */
function extractLocator(locator_text: string): string {
    // Handle ID selectors: locator("#myId") -> \#myId
    // Python: if "#" in locator_text: return r"\#" + locator_text.split("#")[-1].split('"')[0]
    let idMatch = locator_text.match(/#([^"'\s]+)/);
    if (idMatch) {
        // RF needs IDs prefixed with '\'
        return `\\#${idMatch[1]}`;
    }

    // Handle name attributes: ... name="Submit" ... -> "Submit"
    // Python: elif "name=" in locator_text: match = re.search(r'name=\"([^\"]*)\"', locator_text) ... return f'"{match.group(1)}"'
    let nameMatch = locator_text.match(/name\s*=\s*["']([^"']+)["']/);
    if (nameMatch) {
        return `"${nameMatch[1]}"`; // Return just the name value in quotes
    }

     // Handle simple quoted strings within parentheses: ("some value") -> "some value"
     // Python: elif re.search(r'\("([^\"]*)"\)', locator_text): match = re.search(r'\("([^\"]*)"\)', locator_text) ... return f'"{match.group(1)}"'
     let parenMatch = locator_text.match(/^\(*["']([^"']+)["']\)*$/); // Matches ('value') or ("value")
     if (parenMatch) {
          return `"${parenMatch[1]}"`; // Return the content within quotes
     }

     // Handle locator strings that are already quoted (e.g., "text=Login" or 'css=button')
     if ((locator_text.startsWith('"') && locator_text.endsWith('"')) || (locator_text.startsWith("'") && locator_text.endsWith("'"))) {
        // If it's already quoted, return as is (or convert single to double quotes for consistency)
        if (locator_text.startsWith("'")) {
            return `"${locator_text.slice(1, -1)}"`;
        }
        return locator_text;
     }

    // Default case: if it's not an ID, name, or simple parenthesis-quoted string, and not already quoted, quote it.
    // Python: else: return f'"{locator_text}"'
    if (locator_text) {
         return `"${locator_text}"`;
    }

    // Fallback for empty input
    return "";
}


/**
 * Aligns Robot Framework test case steps with standard indentation.
 * Preserves original lines for sections, comments, and blank lines.
 * Indents test steps with 4 spaces.
 * Corrects inconsistent indentation based on Python's align_robot_test_cases logic.
 * @param inputContent The raw content of the .robot file.
 * @returns Formatted content string.
 */
function alignRobotCode(inputContent: string): string {
    const lines = inputContent.split('\n');
    const formattedLines: string[] = [];
    let inTestCaseSection = false;
    let isTestCaseNameLine = false; // Tracks if the current line defines a test case name
    const testCaseIndent = '    '; // Standard 4 spaces

    for (const line of lines) {
        const strippedLine = line.trim(); // Use consistent variable name

        // Section headers
        if (strippedLine.startsWith('***')) {
            formattedLines.push(line.trim()); // Add section header without extra whitespace
            inTestCaseSection = strippedLine.toUpperCase().includes('TEST CASES');
            isTestCaseNameLine = false; // Reset when entering a new section
            continue;
        }

        // Blank lines and comments
        if (!strippedLine || strippedLine.startsWith('#')) {
            formattedLines.push(line); // Preserve blank lines and comments as is
            continue;
        }

        // Inside *** Test Cases *** section
        if (inTestCaseSection) {
            // Line starts with non-space -> It's a test case name
            if (line.match(/^\S/)) {
                formattedLines.push(line.trim()); // Add test case name without leading/trailing space
                isTestCaseNameLine = true;
            }
            // Line starts with space AND we are inside a test case definition -> It's a step
            else if (isTestCaseNameLine && strippedLine) {
                formattedLines.push(testCaseIndent + strippedLine); // Indent the step
            }
            // Other lines within Test Cases (should ideally be steps or comments/blanks handled above)
            else {
                 // Preserve potentially misformatted lines, but trimmed
                 formattedLines.push(line.trim());
            }
        }
        // Outside *** Test Cases *** (Settings, Variables, Keywords)
        else {
             // Preserve these lines, trimmed for consistency
            formattedLines.push(line.trim());
            isTestCaseNameLine = false;
        }
    }

    // Join lines back, ensuring a single trailing newline if the input had one
    let result = formattedLines.join('\n');
    // Remove multiple trailing newlines, keep one if original wasn't empty and ended with newline.
    if (inputContent && inputContent.trimEnd().endsWith('\n')) {
        result = result.replace(/\n+$/, '\n');
    } else {
         result = result.replace(/\n+$/, ''); // Remove all trailing if original didn't end with one
    }
     // Ensure there's a newline between sections if missing
     result = result.replace(/(\*\*\*.*\*\*\*)\n(\S)/g, '$1\n\n$2'); // Add newline after section if next line isn't blank
     result = result.replace(/(\*\*\*.*\*\*\*)\n([ \t]*\*\*\*.*\*\*\*)/g, '$1\n\n$2'); // Add newline between sections

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
    const variableLines = ["*** Variables ***", "${BROWSER}    firefox"]; // Default browser
    let testCaseLines: string[] = ["*** Test Cases ***"];
    let urlCounter = 1;
    const urlMapping: { [key: string]: string } = {};
    let writingStarted = false;
    let firstGoto = true;
    let variable_counter = 1;
    let contextCloseFound = false;

    const rawLines = inputCode.split("\n");
    let lines: string[] = []; // Processed lines (handling page.once etc.)

    // Pre-processing loop (handle page.once as per Python logic)
    rawLines.forEach(line => {
        const stripped = line.trim();
        if (stripped.startsWith("page.once")) {
            // Python example translation: waits for alert and accepts
             // Note: The Robot Framework equivalent might need context depending on the action in page.once
             // This is a specific translation based on the python example provided
             if (stripped.includes('lambda dialog: dialog.dismiss())') || stripped.includes('lambda dialog: dialog.accept())')) {
                 const action = stripped.includes('dismiss') ? 'dismiss' : 'accept';
                 // Placeholder for the user to fill in the specific alert text if needed for assertion
                lines.push('${promise} =       Promise To    Wait For Alert    action=' + action + '   # text=<text content of alert box if you want to assert>');
                // Placeholder comment reminding the user to add the action that triggers the alert
                lines.push('# <Line which triggers the alert action> ex: Click <button selector>');
             } else {
                 lines.push(line); // Keep other page.once lines if they don't match the dismiss/accept pattern
             }
        } else {
            lines.push(line);
        }
    });


    // Main conversion loop
    for (const line of lines) {
        const stripped_line = line.trim();

        if (!stripped_line || stripped_line.startsWith('#')) {
            continue; // Skip empty lines and comments
        }

        // Handle context.close() -> Triggers teardown addition later
        if (stripped_line === "context.close()") {
            contextCloseFound = true;
            break; // Stop processing lines after context.close() as per Python
        }

        // Handle expect(...) assertions
        if (stripped_line.startsWith("expect(")) {
            // Extract locator using regex
            const locatorMatch = stripped_line.match(/expect\((.*?)\)\./); // Get content inside expect()
             if (!locatorMatch) continue;

             const expectContent = locatorMatch[1].trim();
            let locatorSource = expectContent; // The part containing the locator (e.g., page.locator("#id"))

            // Check for common assertion types
            const textAssertionMatch = stripped_line.match(/\.to_contain_text\(['"](.*?)['"]\)/) || stripped_line.match(/\.to_have_text\(['"](.*?)['"]\)/);
            const visibilityAssertionMatch = stripped_line.match(/\.to_be_visible\(\)/);

            let rfLocator = "";
             // Try to extract locator from common Playwright patterns within expect()
             let pwLocatorMatch = expectContent.match(/locator\(['"](.*?)['"]\)/) || expectContent.match(/get_by_.*?\(['"](.*?)['"](?:,\s*.*?)*\)/);
            if (pwLocatorMatch && pwLocatorMatch[1]) {
                 locatorSource = pwLocatorMatch[0]; // Use the full locator part like locator("...")
                 rfLocator = extractLocator(pwLocatorMatch[1]); // Extract the core selector
             } else if (expectContent.startsWith('page.')) {
                 // Handle cases like expect(page.locator(...)) where the locator is the whole content
                 const simpleLocatorMatch = expectContent.match(/page\.(locator|get_by_.*)\(['"](.*?)['"](?:,.*)*\)/);
                 if (simpleLocatorMatch && simpleLocatorMatch[2]) {
                     rfLocator = extractLocator(simpleLocatorMatch[2]);
                 } else {
                     // Fallback if locator extraction inside expect is complex/unrecognized
                     rfLocator = `"${expectContent}"`; // Quote the whole thing as a potential selector
                 }
             } else {
                  // If it's not clearly a page.locator or page.get_by_, treat the content as a potential direct selector
                  rfLocator = extractLocator(expectContent);
             }

            // --- Generate RF steps based on assertion type ---
            if (textAssertionMatch) {
                 const expectedText = textAssertionMatch[1];
                 // Use Get Text for assertion
                 testCaseLines.push(`Get Text    ${rfLocator}    ==    ${expectedText}`);
             } else if (visibilityAssertionMatch) {
                  // Use Wait For Elements State for visibility check
                  testCaseLines.push(`Wait For Elements State    ${rfLocator}    visible    timeout=10s`);
             } else {
                 // Generic fallback for other expect() types - maybe a simple visibility check
                 console.warn(`Unsupported expect() assertion type: ${stripped_line}. Adding generic visibility check.`);
                 testCaseLines.push(`Wait For Elements State    ${rfLocator}    visible    timeout=10s`);
             }
            continue; // Move to next line
        }


        // Handle page.goto(...)
        const gotoMatch = stripped_line.match(/page\d*\.goto\(['"]([^'"]+)['"]\)/);
         if (gotoMatch) {
             writingStarted = true;
             const url = gotoMatch[1];
             let var_name = urlMapping[url]; // Check if URL variable already exists

             if (!var_name) {
                  var_name = `\${URL${urlCounter}}`;
                  urlMapping[url] = var_name;
                 // Add to *** Variables *** section only if not already present
                 if (!variableLines.some(v => v.startsWith(var_name))) {
                     variableLines.push(`${var_name}    ${url}`);
                 }
                  urlCounter++;
             }

             if (firstGoto) {
                 // Add Test Case name and setup steps only on the *first* goto
                 testCaseLines.push("Converted Test Case"); // Default Test Case Name
                 // RF Browser library keywords for setup
                 testCaseLines.push(`New Browser        ${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'firefox'}        headless=False`); // Use defined browser or default
                 testCaseLines.push(`New Context        viewport={'width': 1920, 'height': 1080}`); // Default viewport
                 testCaseLines.push(`New Page            ${var_name}`); // Use the URL variable
                 firstGoto = false; // Mark that setup is done
             } else {
                 // Subsequent navigations use the Go To keyword
                 testCaseLines.push(`Go To    ${var_name}`);
             }
             continue; // Move to next line
         }

        // If writing hasn't started (no goto yet), skip other lines
        if (!writingStarted) {
            continue;
        }

        // Handle browser.close() -> Add RF Close Browser step
        if (stripped_line.startsWith("browser.close")) {
             testCaseLines.push("Close Browser");
             // Consider stopping processing here if browser.close() implies the end
             // writing_started = false; // Python code implies stopping processing after browser.close
             // Let's allow context.close() to handle final teardown for robustness
             continue;
        }


        // --- General command processing (page.click, page.fill, etc.) ---
        // Split the line by '.' respecting quotes (e.g., page.locator("a.b").click())
        const parts = safeSplitOutsideQuotes(stripped_line, '.');
        const commandParts = parts.map(part => part.trim()).filter(part => part); // Clean up parts

        if (commandParts.length < 1) {
            continue; // Skip if parts are empty
        }

        // Identify the method call (last part) and potential locator chain (parts before the method)
        const methodPart = commandParts[commandParts.length - 1]; // e.g., 'click()' or 'fill("text")'
        // Locator chain excludes the first part (page/context) and the last (method)
        const locatorChainParts = commandParts.slice(1, -1); // e.g., ['locator("#id")', 'first']

        // Extract method name and arguments
        const methodMatch = methodPart.match(/^([a-zA-Z_]+)\((.*)\)$/); // Matches 'methodName(arguments)'
        if (methodMatch) {
            const methodNameOnly = methodMatch[1]; // e.g., 'click'
            const methodSignature = `${methodNameOnly}()`; // e.g., 'click()' - used for mapping lookup
            let methodArgsRaw = methodMatch[2]?.trim() ?? ''; // e.g., '"#id"' or '"text", options'

            // Find the corresponding Robot Framework keyword using the mapping
            const transformedMethod = findNearestMatch(methodSignature, mapping);

            // --- Locator Extraction ---
            let rfLocator = "";
            // If there's a locator chain (e.g., page.locator(...).first.click())
            if (locatorChainParts.length > 0) {
                // Prioritize extracting locator from the first element in the chain, which is common
                 const primaryLocatorPart = locatorChainParts[0]; // e.g., 'locator("#id")' or 'get_by_role("button")'
                 const extracted = extractLocator(primaryLocatorPart); // Try to extract from known patterns
                 if (extracted !== `"${primaryLocatorPart}"` || primaryLocatorPart.includes('locator(') || primaryLocatorPart.includes('get_by')) {
                      rfLocator = extracted;
                 } else {
                      // If extraction didn't yield a standard locator, fallback to quoting the whole part
                      rfLocator = `"${primaryLocatorPart}"`;
                 }
                 // Note: Handling complex chains like .first, .nth(0) might require more specific logic
                 if (locatorChainParts.some(p => p === 'first')) {
                     console.warn(`Playwright's '.first' detected. Robot Framework conversion might need manual adjustment for selector specificity. Using base locator: ${rfLocator}`);
                 }
            }
            // If no locator chain, check if the method arguments themselves contain a locator
            // (Common for methods like click, fill if not using page.locator first)
            else if (methodArgsRaw) {
                  // Only treat args as locator if it's not a method that usually takes data first (like fill, type, select_option)
                  const methodsTakingDataFirst = ['fill', 'type', 'press', 'select_option'];
                  if (!methodsTakingDataFirst.includes(methodNameOnly.toLowerCase())) {
                        const extracted = extractLocator(methodArgsRaw);
                         // Check if extraction meaningfully changed the arg (e.g., added quotes, extracted #id)
                         if (extracted !== `"${methodArgsRaw}"`) {
                            rfLocator = extracted;
                             methodArgsRaw = ""; // Args were consumed as locator
                        } else {
                           // If extractLocator just quoted it, it's likely not a standard locator argument for this method
                           rfLocator = "";
                        }
                  }
             }


            // --- Argument Handling & Formatting RF Line ---
             let reformatted_line_parts: string[] = [transformedMethod]; // Start with the RF keyword

             if (rfLocator) {
                 reformatted_line_parts.push(rfLocator); // Add locator if found
             }

             // Handle specific methods and their arguments based on Python logic
             if (methodNameOnly === "select_option") {
                 const args = methodArgsRaw.trim();
                 // RF 'Select Options By' needs label/value/index specifier
                 // Defaulting to 'Value' as per Python example
                 reformatted_line_parts[0] = "Select Options By"; // Override keyword
                 if (!rfLocator) {
                     console.error(`Missing locator for select_option: ${stripped_line}`);
                     reformatted_line_parts.push('"MISSING_LOCATOR"'); // Add placeholder
                 }
                 reformatted_line_parts.push("Value"); // Add specifier

                 // Process args (handle list vs single value)
                 if (args.startsWith("[") && args.endsWith("]")) {
                      // Try parsing as JSON array (more robust)
                      try {
                         const parsedArgs = JSON.parse(args.replace(/'/g, '"')); // Replace single quotes for JSON
                         if (Array.isArray(parsedArgs)) {
                             // RF list variable format often uses multiple spaces as separator
                             reformatted_line_parts.push(...parsedArgs.map(String)); // Add each value as separate arg
                         } else {
                              reformatted_line_parts.push(args); // Fallback if not array
                         }
                      } catch {
                          // Fallback for malformed list string
                          reformatted_line_parts.push(args.slice(1, -1).replace(/['",\s]+/g, '    ')); // Heuristic split
                      }
                 } else {
                     // Single value, remove quotes if present
                     reformatted_line_parts.push(args.replace(/^["']|["']$/g, ''));
                 }

             } else if (methodArgsRaw) {
                 // General case: Add remaining arguments, cleaning outer quotes
                 const cleanedArgs = methodArgsRaw.split(',').map(arg => arg.trim().replace(/^["'](.*)["']$/, '$1'));
                  reformatted_line_parts.push(...cleanedArgs);
             }

             // Join parts with RF standard separator (4 spaces) and trim
             testCaseLines.push(reformatted_line_parts.join('    ').trim());

        } else {
             // Fallback for lines that don't match the standard method call pattern
             // Try to interpret as a simple keyword call, potentially with arguments joined by spaces
             console.warn(`Line could not be parsed as standard method call: "${stripped_line}". Adding as raw parts.`);
             testCaseLines.push(commandParts.join('    ')); // Join with RF separator
        }
    }

     // --- Teardown ---
     // Add teardown steps based on whether context.close() was found or if conversion started
     if (contextCloseFound) {
         // If context.close() was explicitly found, add Close Context and Close Browser
         testCaseLines.push("Close Context");
         testCaseLines.push("Close Browser");
     } else if (writingStarted) { // If conversion started (e.g., page.goto was found) but no explicit close
         const lastStep = testCaseLines[testCaseLines.length - 1]?.trim();
         // Add default teardown unless already closing context/browser
         if (lastStep && !lastStep.startsWith('Close Context') && !lastStep.startsWith('Close Browser')) {
             testCaseLines.push("Close Context");
             testCaseLines.push("Close Browser");
         }
     }


    // Combine all sections (Settings, Variables, Test Cases)
    const final_output_lines = [
        ...outputLines,
        '', // Blank line separator
        ...variableLines,
        '', // Blank line separator
        ...testCaseLines
    ];

    const final_output = final_output_lines.join('\n');

    // Apply alignment formatting as the very last step
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
                 fileContent: robotCode, // Send single file content directly
             };

        } else {
             if (!Array.isArray(inputFiles)) {
                 return { success: false, error: 'Input is marked as folder, but only a single file was provided.' };
             }
             // --- Folder Conversion ---
             const inputFolderFiles = inputFiles;
             // Attempt to get folder name from relative path, fallback to a default name
             const firstFilePath = inputFolderFiles[0]?.webkitRelativePath;
             const inputFolderName = firstFilePath ? firstFilePath.split('/')[0] : 'python_scripts';
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
                zipBuffer: zipBuffer, // Send zip buffer
            };
        }
    } catch (error: any) {
        console.error('Conversion process error:', error);
         let errorMessage = 'An unexpected server error occurred during conversion.';
         if (error instanceof Error) {
             errorMessage = `Conversion failed: ${error.message}`;
             if (error.stack) {
                 console.error("Stack Trace:", error.stack); // Log stack trace for debugging
             }
         }
         return { success: false, error: errorMessage };
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
