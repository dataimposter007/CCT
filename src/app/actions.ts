'use server';

import type { z } from 'zod';
import * as zod from 'zod';
import * as xlsx from 'xlsx';
import AdmZip from 'adm-zip';
import { chatFlow, type ChatFlowInput } from '@/ai/flows/chat-flow'; // Import chat flow

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
        // Ensure the key is a string before calling includes
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
             // Handle lines that *should* be steps but might lack initial whitespace (e.g., after a blank line)
             else if (!isTestCaseNameLine && strippedLine && !strippedLine.startsWith('***')) {
                 // Assume this is a step if it's not a test case name or section header
                 formattedLines.push(testCaseIndent + strippedLine);
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
        // Handle page.once specific dismissal/acceptance
        if (stripped.startsWith("page.once(\"dialog\"") && stripped.endsWith("lambda dialog: dialog.dismiss())")) {
             // Python code adds these two lines specifically for page.once dismiss
             testCaseLines.push('    ${promise} =       Promise To    Wait For Alert    action=dismiss');
             testCaseLines.push('    # <Line which triggers the alert action> ex: Click <button selector>');
         } else if (stripped.startsWith("page.once(\"dialog\"") && stripped.endsWith("lambda dialog: dialog.accept())")) {
             // Python code adds these two lines for page.once accept
             testCaseLines.push('    ${promise} =       Promise To    Wait For Alert    action=accept   # text=<text content of alert box if you want to assert>');
             testCaseLines.push('    # <Line which triggers the alert action> ex: Click <button selector>');
         } else {
             // Keep other lines, including potentially other page.once uses or non-page.once lines
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
            // Extract locator using regex - simplified approach
            // Look for common patterns like page.locator, get_by_*
            // Modified regex to handle variations like page.locator(...) or just locator(...)
            let locatorMatch = stripped_line.match(/(?:page\.)?(?:locator|get_by_.*?)\(['"](.*?)['"](?:,.*?)?\)/);
            let rfLocator = "";
            if (locatorMatch && locatorMatch[1]) {
                rfLocator = extractLocator(locatorMatch[1]); // Extract the core selector
            } else {
                // If a standard locator pattern isn't found inside expect(), try a broader match
                const fallbackLocatorMatch = stripped_line.match(/expect\((.*?)\)/);
                if (fallbackLocatorMatch && fallbackLocatorMatch[1]) {
                     // Try to extract from the inner content if it looks like a simple selector
                     const innerContent = fallbackLocatorMatch[1].trim();
                     // Basic check if it might be a selector (e.g., starts with #, ., " or ')
                     if (innerContent.match(/^['"#.]/) || innerContent.includes('=')) {
                        rfLocator = extractLocator(innerContent);
                     } else {
                        console.warn(`Could not reliably extract locator from expect(): ${stripped_line}. Skipping assertion.`);
                        continue; // Skip this line if locator extraction fails
                     }
                } else {
                     console.warn(`Could not parse expect() statement: ${stripped_line}. Skipping.`);
                     continue; // Skip if expect() content is not parseable
                }
            }

            // Check for assertion types
            const textAssertionMatch = stripped_line.match(/\.to_(?:contain|have)_text\(['"](.*?)['"](?:,.*)?\)/);
            const visibilityAssertionMatch = stripped_line.match(/\.to_be_visible\(\)/);

            // Generate RF steps based on assertion type
            if (textAssertionMatch) {
                 const expectedText = textAssertionMatch[1];
                 const variable_name = `\${var${variable_counter++}}`;
                 testCaseLines.push(`    ${variable_name}    Set Variable    ${rfLocator}`); // Assign locator to RF variable
                 testCaseLines.push(`    Wait For Elements State    ${variable_name}    visible    timeout=10s`);
                 // Use '==' for exact match, or 'contains' based on to_contain_text vs to_have_text
                 const operator = stripped_line.includes('.to_have_text') ? '==' : '*='; // Adjust if needed
                 testCaseLines.push(`    Get Text    ${variable_name}    ${operator}    ${expectedText}`);
            } else if (visibilityAssertionMatch) {
                 const variable_name = `\${var${variable_counter++}}`;
                 testCaseLines.push(`    ${variable_name}    Set Variable    ${rfLocator}`);
                 testCaseLines.push(`    Wait For Elements State    ${variable_name}    visible    timeout=10s`);
            } else {
                console.warn(`Unsupported assertion type in expect(): ${stripped_line}. Adding generic visibility check.`);
                const variable_name = `\${var${variable_counter++}}`;
                 testCaseLines.push(`    ${variable_name}    Set Variable    ${rfLocator}`);
                testCaseLines.push(`    Wait For Elements State    ${variable_name}    visible    timeout=10s`); // Fallback check
            }
            continue; // Move to next line
        }


        // Handle page.goto(...)
        // Matches page.goto("URL") or page1.goto("URL") etc.
        const gotoMatch = stripped_line.match(/page\d*\.goto\(['"]([^'"]+)['"](?:,\s*\{.*?})?\)/);
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
                  // RF Test Case definition and setup keywords
                  testCaseLines.push("Test Case"); // Use standard "Test Case" as per python code
                  testCaseLines.push(`    New Browser        ${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'firefox'}        headless=False    timeout=60000    slowMo=0:00:01`); // Added timeout and slowMo from python
                  testCaseLines.push(`    New Context        viewport={'width': 1920, 'height': 1080}`); // Default viewport
                  testCaseLines.push(`    New Page            ${var_name}`); // Open the first page
                  firstGoto = false; // Mark setup as done
              } else {
                  // Subsequent navigations use the Go To keyword
                  testCaseLines.push(`    Go To    ${var_name}`);
              }
             continue; // Move to next line
         }

        // If writing hasn't started (no goto yet), skip other lines
        if (!writingStarted) {
            continue;
        }

        // Handle browser.close() -> Add RF Close Browser step
        if (stripped_line.startsWith("browser.close")) {
             testCaseLines.push("    Close Browser");
             writingStarted = false; // As per python logic
             continue;
        }


        // --- General command processing (page.click, page.fill, etc.) ---
        const parts = safeSplitOutsideQuotes(stripped_line, '.');
        const commandParts = parts.map(part => part.trim()).filter(part => part);

        if (commandParts.length < 1) continue;

        const methodPart = commandParts[commandParts.length - 1];
        // Join locator parts back if split by safeSplit - needed for complex locators like page.get_by_role(...).locator(...)
        const objectPart = commandParts.length > 1 ? commandParts.slice(0, -1).join('.') : ''; // e.g., "page" or "page.get_by_role(...)"

        const methodMatch = methodPart.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/);
        if (methodMatch) {
            const methodNameOnly = methodMatch[1];
            const methodSignature = `${methodNameOnly}()`; // Use '()' for mapping lookup
            let methodArgsRaw = methodMatch[2]?.trim() ?? '';

             // Find the corresponding Robot keyword using the mapping
            const transformedMethod = findNearestMatch(methodSignature, mapping);

            // --- Locator Extraction from chain or args ---
             let rfLocator = "";
            let locatorTextRaw = ""; // Store the raw text used to extract locator

            // If the objectPart contains locator methods (like locator, get_by_*)
             const locatorExtractionMethods = ['locator', 'get_by_text', 'get_by_role', 'get_by_label', 'get_by_placeholder', 'get_by_alt_text', 'get_by_title'];
             if (locatorExtractionMethods.some(m => objectPart.includes(`.${m}(`)) || objectPart.startsWith('locator(')) {
                 locatorTextRaw = objectPart; // The chain part itself defines the locator
                 rfLocator = extractLocator(objectPart);
             }
             // Handle cases where locator is the first argument of the *method* (e.g., click, fill)
             else if (methodArgsRaw) {
                  // Exclude methods that take data first (press, select_option, wait_for_timeout, evaluate)
                  // Include methods like click, fill, type, check, dblclick, hover, etc. where locator might be first arg
                  const methodsTakingLocatorFirst = ['click', 'fill', 'type', 'check', 'uncheck', 'dblclick', 'hover', 'press', 'focus', 'scroll_into_view_if_needed', 'tap', 'set_input_files'];
                  if (methodsTakingLocatorFirst.includes(methodNameOnly)) {
                      // Assume the first argument *might* be the locator - requires careful splitting
                      const argsList = safeSplitOutsideQuotes(methodArgsRaw, ','); // Split args respecting quotes
                      if (argsList.length > 0) {
                           const potentialLocatorArg = argsList[0].trim();
                          // Check if it looks like a locator (starts with quote, #, or contains =)
                          if (potentialLocatorArg.match(/^['"#.]/) || potentialLocatorArg.includes('=')) {
                              locatorTextRaw = potentialLocatorArg;
                              rfLocator = extractLocator(potentialLocatorArg);
                              // Remove the locator argument from methodArgsRaw
                              methodArgsRaw = argsList.slice(1).join(',').trim();
                          } else {
                              // First arg doesn't look like a typical locator string
                              // console.warn(`First argument for ${methodNameOnly} is not a simple string locator: ${potentialLocatorArg}. Assuming no locator arg.`);
                          }
                      }
                  }
             }

             // Specific override for get_by_role("button", name="Sign in") -> "Sign in"
             if (locatorTextRaw.includes('get_by_role("button", name=')) {
                 const nameMatch = locatorTextRaw.match(/name=["']([^"']+)["']/);
                 if (nameMatch) {
                     rfLocator = `"${nameMatch[1]}"`;
                 }
             }


            // --- Argument Handling & Formatting RF Line ---
            let reformatted_line_parts: string[] = [transformedMethod];

            if (rfLocator) {
                reformatted_line_parts.push(rfLocator);
            }

             if (methodNameOnly === "select_option") {
                  const argsList = safeSplitOutsideQuotes(methodArgsRaw, ',');
                  const selectValue = argsList.length > 0 ? argsList[0].trim() : ''; // Get the first arg
                 // Python logic uses the transformed method directly if args starts with '['
                 // otherwise it uses 'Select options by' + locator + 'Value' + args
                  if (selectValue.startsWith("[") && selectValue.endsWith("]")) {
                     // RF 'Select Options By' keyword expects label or value after the locator
                      reformatted_line_parts[0] = "Select Options By"; // Change keyword
                      if (!rfLocator) {
                        console.error(`Missing locator for select_option with list: ${stripped_line}. Using placeholder.`);
                        reformatted_line_parts.push('"MISSING_LOCATOR"');
                      }
                       // Attempting to select multiple options by *value* is common
                      reformatted_line_parts.push("Value");
                      // Reformat the list ['a', 'b'] to "a", "b" for RF multiple selection
                      const options = selectValue.slice(1, -1).split(',').map(opt => opt.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
                      reformatted_line_parts.push(...options.map(opt => `"${opt}"`));
                  } else {
                      // Single selection
                      reformatted_line_parts[0] = "Select Options By"; // Change keyword
                      if (!rfLocator) {
                         console.error(`Missing locator for select_option: ${stripped_line}. Using placeholder.`);
                         reformatted_line_parts.push('"MISSING_LOCATOR"');
                      }
                     reformatted_line_parts.push("Value"); // Assume selecting by value
                      reformatted_line_parts.push(selectValue.replace(/^['"]|['"]$/g, '')); // Add the single value (unquoted)
                  }
             } else if (methodArgsRaw) {
                // Clean args as per python: re.sub(r'^"(.*)"$', r'\1', method_args)
                 // Remove outer quotes only if they wrap the whole string
                 const cleanedArgs = methodArgsRaw.trim().replace(/^['"](.*)['"]$/, '$1');

                // Split potentially multiple arguments
                const remainingArgsList = safeSplitOutsideQuotes(cleanedArgs, ',');

                 // Add remaining args, unquoting each if necessary
                 remainingArgsList.forEach(arg => {
                    const trimmedArg = arg.trim();
                     if (trimmedArg) {
                         // Unquote if the argument itself is fully quoted
                         reformatted_line_parts.push(trimmedArg.replace(/^['"](.*)['"]$/, '$1'));
                     }
                 });
             }

             testCaseLines.push("    " + reformatted_line_parts.join('    ').trim());

        } else {
             // Fallback for lines not matching method pattern (less common)
             // Python code joins with '    '
             testCaseLines.push("    " + commandParts.join('    '));
        }
    }

    // --- Teardown ---
    if (contextCloseFound) {
        testCaseLines.push("    Close Context");
        testCaseLines.push("    Close Browser");
    } else if (writingStarted) { // Add default teardown if conversion started but no explicit close found
        const lastStep = testCaseLines[testCaseLines.length - 1]?.trim();
        // Ensure teardown isn't added if already present
        if (lastStep && !lastStep.startsWith('Close Context') && !lastStep.startsWith('Close Browser')) {
            testCaseLines.push("    Close Context");
            testCaseLines.push("    Close Browser");
        }
    }


    const final_output_lines = [
        ...outputLines,
        '', // Add empty line between sections
        ...variableLines,
        '', // Add empty line between sections
        ...testCaseLines
    ];

    const final_output = final_output_lines.join('\n');
    return alignRobotCode(final_output); // Apply alignment formatting
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


// --- Chatbot Action ---
export async function handleChatMessage(input: ChatFlowInput): Promise<string> {
  console.log(`Handling message: "${input.message}"`);
  if (!process.env.GOOGLE_GENAI_API_KEY) {
    console.error('MISSING API KEY: The GOOGLE_GENAI_API_KEY environment variable is not set.');
    return 'Sorry, the chatbot is not configured correctly. Missing API key.';
  }

  try {
    console.log(`Sending message to chatFlow: ${input.message}`);
    const result = await chatFlow(input);
    console.log(`Received response from chatFlow: ${result.answer}`);
    return result.answer;
  } catch (error: any) {
    console.error('Error handling chat message in action:', error);
    // Log specific details
    let detailedErrorMessage = 'Sorry, I encountered an error processing your request.';
    if (error instanceof Error) {
        console.error('Error Name:', error.name);
        console.error('Error Message:', error.message);
        // Check for common API key or permission errors
        if (error.message.includes('API key not valid') || error.message.includes('permission denied')) {
            detailedErrorMessage = 'There seems to be an issue with the chatbot configuration (API key or permissions). Please contact support.';
            console.error('Potential API Key or Permission Issue Detected.');
        } else if (error.message.includes('quota')) {
            detailedErrorMessage = 'The chatbot service is currently experiencing high traffic. Please try again later.';
            console.error('Potential Quota Issue Detected.');
        }
        console.error('Error Stack:', error.stack);
    } else {
        console.error('Unknown error object:', error);
    }
    // Return a user-friendly but informative message
    return detailedErrorMessage + ' (Check server logs for details)';
  }
}

    