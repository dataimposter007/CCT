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
    // Preserve original method name exactly if no match is found, including parentheses if present initially.
    return method_name_with_parens;
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
    let idMatch = locator_text.match(/locator\s*\(\s*["']#([^"'\s]+)["']\s*\)/); // More specific ID match within locator()
    if (idMatch) {
        // RF needs IDs prefixed with '\' for ambiguity, but often just 'id=myId' works too.
        // Sticking to the python logic's apparent intent (though RF handles id= better usually).
        return `\\#${idMatch[1]}`;
    }

    // Handle name attributes: ... name="Submit" ... -> "Submit"
    // Python: elif "name=" in locator_text: match = re.search(r'name=\"([^\"]*)\"', locator_text) ... return f'"{match.group(1)}"'
    let nameMatch = locator_text.match(/name\s*=\s*["']([^"']+)["']/);
    if (nameMatch) {
        // Python code returns just the quoted value, which might not be enough context for RF.
        // RF browser often prefers syntax like 'name=Submit' or '//[@name="Submit"]'.
        // Returning the simple quoted value as per python logic for now.
        return `"${nameMatch[1]}"`;
    }

     // Handle simple quoted strings within parentheses: ("some value") -> "some value"
     // Python: elif re.search(r'\("([^\"]*)"\)', locator_text): match = re.search(r'\("([^\"]*)"\)', locator_text) ... return f'"{match.group(1)}"'
     // This Python regex seems aimed at top-level function calls like click("Submit")
     // Let's adapt it to look for patterns like `locator("value")` or `get_by_text("value")` etc.
     let simpleQuoteMatch = locator_text.match(/(?:locator|get_by_text|get_by_label|get_by_placeholder|get_by_alt_text|get_by_title)\s*\(\s*["']([^"']+)["']\s*\)/);
     if (simpleQuoteMatch) {
          return `"${simpleQuoteMatch[1]}"`; // Return the content within quotes
     }


     // Handle locator strings that are already quoted RF-style (e.g., "text=Login" or 'css=button')
      let rfStyleMatch = locator_text.match(/locator\s*\(\s*["'](.*?=.*?)["']\s*\)/);
      if (rfStyleMatch) {
           // If it's already in RF style (e.g., "text=Login"), return as is (quoted).
           return `"${rfStyleMatch[1]}"`;
      }


    // Default case: if it's not an ID, name, or simple parenthesis-quoted string, quote it.
    // Python: else: return f'"{locator_text}"'
    // This seems too broad. Let's return the original text if no specific pattern matched.
    // The calling function will need to decide how to handle it.
    // If the raw locator text itself was quoted, return it quoted.
     if ((locator_text.startsWith('"') && locator_text.endsWith('"')) || (locator_text.startsWith("'") && locator_text.endsWith("'"))) {
        if (locator_text.startsWith("'")) {
            return `"${locator_text.slice(1, -1)}"`; // Convert single to double quotes
        }
        return locator_text; // Return as is (double quoted)
     }

    // If it doesn't match known patterns and isn't already quoted, return it unquoted for now.
    // The calling code might need more sophisticated handling.
    console.warn(`Could not extract standard RF locator from: "${locator_text}". Returning raw value.`);
    return locator_text;


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
    let inVariablesSection = false; // Track if inside *** Variables ***
    let isTestCaseNameLine = false; // Tracks if the current line defines a test case name
    const testCaseIndent = '    '; // Standard 4 spaces

    for (const line of lines) {
        const trimmedLine = line.trim(); // Use consistent variable name

        // Section headers
        if (trimmedLine.startsWith('***')) {
            formattedLines.push(trimmedLine); // Add section header without extra whitespace
            inTestCaseSection = trimmedLine.toUpperCase().includes('TEST CASES');
            inVariablesSection = trimmedLine.toUpperCase().includes('VARIABLES');
            isTestCaseNameLine = false; // Reset when entering a new section
            continue;
        }

        // Blank lines and comments
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            formattedLines.push(line); // Preserve blank lines and comments as is
            continue;
        }

        // Inside *** Test Cases *** section
        if (inTestCaseSection) {
            // Line starts with non-space -> It's a test case name
            // Added check to ensure it's not just settings/keywords inside the section
            if (line.match(/^\S/) && !trimmedLine.startsWith('[')) { // Avoid indenting things like [Documentation] or [Tags]
                formattedLines.push(trimmedLine); // Add test case name without leading/trailing space
                isTestCaseNameLine = true;
            }
            // Line starts with space OR is a setting/keyword like [Documentation] -> Indent as a step/setting
            else if (trimmedLine) { // Any non-empty line within a test case definition block
                // Ensure the line is not already indented correctly
                if (!line.startsWith(testCaseIndent)) {
                     formattedLines.push(testCaseIndent + trimmedLine); // Indent the step/setting
                } else {
                    formattedLines.push(line); // Keep existing indentation if it starts with the correct indent
                }
                 // If this line was the start of steps, subsequent lines should also be indented
                 // We don't reset isTestCaseNameLine here, because steps belong to the last defined test case name
            } else {
                 // Preserve potentially misformatted lines, but trimmed (should be blank/comment)
                 formattedLines.push(trimmedLine);
            }
        }
        // Inside *** Variables *** section
        else if (inVariablesSection) {
             // Variables should not be indented according to standard RF style
             formattedLines.push(trimmedLine);
             isTestCaseNameLine = false;
        }
        // Outside known step/variable sections (Settings, Keywords)
        else {
             // Preserve these lines, trimmed for consistency
            formattedLines.push(trimmedLine);
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

     // Ensure at least one blank line after section headers before content
     result = result.replace(/(\*\*\*.*\*\*\*\n)([^ \n#*])/g, '$1\n$2');

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
    let currentTestCaseName = "Test Case"; // Default test case name if none found before steps
    let testCaseDefined = false; // Flag to check if a test case name line has been added

    let urlCounter = 1;
    const urlMapping: { [key: string]: string } = {};
    let writingStarted = false; // Tracks if conversion logic should actively process lines (e.g., after first goto)
    let firstGoto = true; // Tracks if the first page.goto has been processed
    let variable_counter = 1; // Counter for generating unique variable names for locators
    let contextCloseFound = false; // Tracks if context.close() was encountered

    const rawLines = inputCode.split("\n");
    let lines: string[] = []; // Array to hold pre-processed lines (handling page.once etc.)

    // --- Pre-processing loop (Handle specific page.once scenarios from Python code) ---
     rawLines.forEach(line => {
         const stripped = line.trim();
        // Handle page.once specific dismissal/acceptance based on Python logic
        if (stripped.startsWith("page.once(\"dialog\"") && stripped.endsWith("lambda dialog: dialog.dismiss())")) {
             // Python code adds these two lines specifically for page.once dismiss
             lines.push('    ${promise} =       Promise To    Wait For Alert    action=dismiss');
             lines.push('    # <Line which triggers the alert action> ex: Click <button selector>');
         } else if (stripped.startsWith("page.once(\"dialog\"") && stripped.endsWith("lambda dialog: dialog.accept())")) {
             // Python code adds these two lines for page.once accept
             lines.push('    ${promise} =       Promise To    Wait For Alert    action=accept   # text=<text content of alert box if you want to assert>');
             lines.push('    # <Line which triggers the alert action> ex: Click <button selector>');
         } else {
             // Keep other lines, including potentially other page.once uses or non-page.once lines
             lines.push(line);
         }
     });


    // --- Main conversion loop ---
    for (const line of lines) {
        const stripped_line = line.trim();

        // Skip empty lines and comments
        if (!stripped_line || stripped_line.startsWith('#')) {
            continue;
        }

         // --- Detect Test Case Name (simple heuristic: often a comment before the first action) ---
        // This is a basic approach; more robust parsing might be needed for complex files.
        if (!writingStarted && stripped_line.startsWith('# Test Case:')) {
            currentTestCaseName = stripped_line.replace('# Test Case:', '').trim();
            // Ensure the test case name line is added only once before the first step
             if (!testCaseDefined) {
                 testCaseLines.push(currentTestCaseName);
                 testCaseDefined = true;
             }
            continue; // Move to the next line after capturing the name
        }


        // Handle context.close() -> Triggers teardown addition later
        if (stripped_line === "context.close()") {
            contextCloseFound = true;
            // Don't necessarily break here, allow subsequent browser.close() if present
        }

        // Handle expect(...) assertions
        // Python code uses regex: re.search(r'locator\("([^"]+)"\)', stripped_line)
        if (stripped_line.startsWith("expect(")) {
             // Ensure test case name is added if not already
              if (!testCaseDefined) {
                  testCaseLines.push(currentTestCaseName);
                  testCaseDefined = true;
              }

            // Attempt to extract locator using a more general regex first
            let locatorMatch = stripped_line.match(/(?:page\.)?(?:locator|get_by_.*?)\((.*?)\)/);
             let rfLocator = "";
             if (locatorMatch && locatorMatch[1]) {
                 // Extract the inner part and pass to extractLocator
                 rfLocator = extractLocator(locatorMatch[1].trim());
             } else {
                 // Fallback for simpler expect(selector)... patterns
                 const simpleExpectMatch = stripped_line.match(/expect\((.*?)\)\./);
                 if (simpleExpectMatch && simpleExpectMatch[1]) {
                      rfLocator = extractLocator(simpleExpectMatch[1].trim());
                 } else {
                     console.warn(`Could not reliably extract locator from expect(): ${stripped_line}. Skipping assertion step.`);
                     continue; // Skip if locator extraction fails
                 }
             }


            // Check for assertion types (based on Python code's regex)
            // Python: re.search(r'to_contain_text\("([^"]+)"\)', stripped_line)
            const textAssertionMatch = stripped_line.match(/\.to_(?:contain|have)_text\((.*?)(?:,\s*\{.*?})?\)/); // Handle options like timeout
            const visibilityAssertionMatch = stripped_line.match(/\.to_be_visible\(\)/);


            if (textAssertionMatch) {
                 // Extract expected text carefully, handling potential quotes
                 let expectedText = textAssertionMatch[1].trim();
                 if ((expectedText.startsWith('"') && expectedText.endsWith('"')) || (expectedText.startsWith("'") && expectedText.endsWith("'"))) {
                     expectedText = expectedText.slice(1, -1);
                 }
                 const variable_name = `\${var${variable_counter++}}`;
                 testCaseLines.push(`    ${variable_name}    Set Variable    ${rfLocator}`); // Assign locator to RF variable
                 testCaseLines.push(`    Wait For Elements State    ${variable_name}    visible    timeout=10s`);
                 // Use '==' for exact match (to_have_text), or 'should contain' for to_contain_text
                 const assertionKeyword = 'Get Text'; // Using Get Text for both, comparison happens next
                 const comparisonOperator = stripped_line.includes('.to_have_text') ? '==' : '*='; // RF uses '==' for exact, '*=' for contains
                 testCaseLines.push(`    ${assertionKeyword}    ${variable_name}    ${comparisonOperator}    ${expectedText}`);
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
        // Python: re.match(r'page\d*\.goto\("[^"]+"\)', stripped_line)
        // Python uses url_match = re.search(r'\("([^\"]*)"\)', stripped_line) to extract URL
         const gotoMatch = stripped_line.match(/page\d*\.goto\(\s*["']([^'"]+)["']\s*(?:,\s*\{.*?})?\)/); // Handle options dict
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
                 if (!testCaseDefined) { // Ensure test case name is added if not already
                     testCaseLines.push(currentTestCaseName);
                     testCaseDefined = true;
                 }
                  // RF Test Case setup keywords from Python code
                  testCaseLines.push(`    New Browser        ${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'firefox'}        headless=False    timeout=60000    slowMo=0:00:01`);
                  testCaseLines.push(`    New Context        viewport={'width': 1920, 'height': 1080}`); // Default viewport
                  testCaseLines.push(`    New Page            ${var_name}`); // Open the first page
                  firstGoto = false; // Mark setup as done
              } else {
                  // Subsequent navigations use the Go To keyword
                   if (!testCaseDefined) { // Ensure test case name is added if not already
                       testCaseLines.push(currentTestCaseName);
                       testCaseDefined = true;
                   }
                  testCaseLines.push(`    Go To    ${var_name}`);
              }
             continue; // Move to next line
         }

        // If writing hasn't started (no goto/assertion yet), skip other lines
        if (!writingStarted) {
            continue;
        }

        // Handle browser.close() -> Add RF Close Browser step
        // Python: stripped_line.startswith("browser.close")
        if (stripped_line.startsWith("browser.close")) {
             // Ensure test case name is added if not already
              if (!testCaseDefined) {
                  testCaseLines.push(currentTestCaseName);
                  testCaseDefined = true;
              }
             testCaseLines.push("    Close Browser");
             // Python code sets writingStarted = False here, suggesting maybe further lines shouldn't be processed? Let's adhere to that.
             // writingStarted = false; // Let's comment this out, context.close() seems the more definitive end point
             continue;
        }


        // --- General command processing (page.click, page.fill, etc.) ---
         // Python uses: parts = safe_split_outside_quotes(stripped_line)
        const parts = safeSplitOutsideQuotes(stripped_line, '.');
        const commandParts = parts.map(part => part.trim()).filter(part => part);

        if (commandParts.length < 1) continue;

         // Python: method = parts[-1], locator_chain = parts[1:-1]
        const methodPart = commandParts[commandParts.length - 1];
        // Reconstruct object part handling methods like get_by_role("button", name="Sign in")
        const objectPart = commandParts.length > 1 ? commandParts.slice(0, -1).join('.') : ''; // e.g., "page" or "page.get_by_role(...)"

        // Python: method_match = re.match(r'([a-zA-Z_]+)\((.*)\)', method)
        const methodMatch = methodPart.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/);
        if (methodMatch) {
            const methodNameOnly = methodMatch[1];
            // Python uses method_name = method_match.group(1) + "()" for mapping lookup
            const methodSignatureForMapping = `${methodNameOnly}()`;
            let methodArgsRaw = methodMatch[2]?.trim() ?? '';

             // Python: transformed_method = find_nearest_match(method_name, mapping)
            const transformedMethod = findNearestMatch(methodSignatureForMapping, mapping);

            // --- Locator Extraction ---
             // Python uses locator_text = "<" + "><".join(locator_chain) + ">" if locator_chain else ""
             // then locator_text = re.search(r'<(.*)>', locator_text).group(1)
             // then locator_text = extract_locator(locator_text)
             let rfLocator = "";
             let locatorSource = ""; // What part of the line provided the locator

             // Use the full object part (e.g., `page.get_by_role(...)`) for locator extraction if it exists and isn't just "page"
             if (objectPart && !objectPart.startsWith('page')) {
                  locatorSource = objectPart + '.' + methodNameOnly + '(' + methodArgsRaw + ')'; // Reconstruct the call for extractLocator
                  // If objectPart was used, args might be empty now in methodArgsRaw for some methods
             }
             // If objectPart didn't contain the locator info, check method arguments
             else if (methodArgsRaw) {
                 const argsList = safeSplitOutsideQuotes(methodArgsRaw, ',');
                 const potentialLocatorArg = argsList[0]?.trim();
                  // A simple heuristic: if the first argument is quoted or contains '=', assume it's the primary locator
                  if (potentialLocatorArg && (potentialLocatorArg.match(/^["']/) || potentialLocatorArg.includes('=')) && !potentialLocatorArg.includes(':')) {
                      locatorSource = potentialLocatorArg;
                      // Remove the locator argument from the list for further processing
                       methodArgsRaw = argsList.slice(1).join(',').trim();
                  } else {
                       // If first arg wasn't the locator, the raw method args themselves might be the locator
                       locatorSource = methodArgsRaw;
                       // Clear methodArgsRaw if it was fully used as the locator
                       if (extractLocator(locatorSource) !== locatorSource) { // Check if extractLocator actually did something
                            methodArgsRaw = '';
                       }
                  }
             }
             // Handle cases where the locator might be directly in the object part like page.locator(...)
             else if (objectPart.includes('locator(') || objectPart.includes('get_by_')) {
                  locatorSource = objectPart;
             }


             if (locatorSource) {
                 rfLocator = extractLocator(locatorSource);
             }


             // Ensure test case name is added if not already
             if (!testCaseDefined) {
                 testCaseLines.push(currentTestCaseName);
                 testCaseDefined = true;
             }


            // --- Argument Handling & Formatting RF Line ---
            // Python logic for select_option():
            // if method_name == "select_option()":
            //     args = method_args.strip()
            //     if args.startswith("["): -> {transformed_method}    {locator_text}    {args}
            //     else: -> Select options by    {locator_text}      Value      {args}
            // elif method_args: -> {transformed_method}    {locator_text}    {cleaned_args}
            // else: -> {transformed_method}    {locator_text}
            let reformatted_line_parts: string[] = [transformedMethod];

            if (rfLocator) {
                 // Handle cases where extractLocator returned the original unquoted text
                 if (!(rfLocator.startsWith('"') && rfLocator.endsWith('"')) && !(rfLocator.startsWith('\\#'))) {
                     // Quote only if it doesn't look like an RF variable or already quoted ID
                     if (!rfLocator.startsWith('${')) {
                        reformatted_line_parts.push(`"${rfLocator}"`); // Quote if not already quoted or an ID
                     } else {
                         reformatted_line_parts.push(rfLocator); // Keep variable as is
                     }
                 } else {
                    reformatted_line_parts.push(rfLocator);
                 }
            }

             if (methodNameOnly === "select_option") {
                 const selectArgs = methodArgsRaw.trim();
                 // Default to 'Select Options By Value' as per python else block
                 reformatted_line_parts[0] = "Select Options By"; // Change keyword
                 if (!rfLocator) { // Need a locator for select_options_by
                     console.error(`Missing locator for select_option: ${stripped_line}. Skipping.`);
                     continue;
                 }

                  if (selectArgs.startsWith("[") && selectArgs.endsWith("]")) {
                      // Python just appends the list string: {transformed_method}    {locator_text}    {args}
                      // Robot Framework's "Select Options By" expects individual values/labels/indexes
                      // We'll assume values for now. Parsing the Python list string.
                       reformatted_line_parts.push("Value"); // Assume selecting by value
                       try {
                           // Simple parse: remove brackets, split by comma, trim quotes/spaces
                            const options = selectArgs.slice(1, -1).split(',')
                                .map(opt => opt.trim().replace(/^['"]|['"]$/g, ''));
                           options.forEach(opt => reformatted_line_parts.push(String(opt)));

                       } catch (e) {
                            console.warn(`Could not parse options list for select_option: ${selectArgs}. Adding raw string (may cause RF error).`);
                            reformatted_line_parts.push(selectArgs); // Add raw string on error
                       }

                  } else {
                      // Single selection by value
                      reformatted_line_parts.push("Value");
                      // Remove potential outer quotes from the value
                      const cleanedValue = selectArgs.replace(/^['"]|['"]$/g, '');
                      reformatted_line_parts.push(cleanedValue);
                  }
             } else if (methodArgsRaw) {
                // Python: cleaned_args = re.sub(r'^"(.*)"$', r'\1', method_args)
                 let cleanedArgs = methodArgsRaw.trim();
                 // Remove outer quotes only if they wrap the *entire* argument string
                 if ((cleanedArgs.startsWith('"') && cleanedArgs.endsWith('"')) || (cleanedArgs.startsWith("'") && cleanedArgs.endsWith("'"))) {
                     cleanedArgs = cleanedArgs.slice(1, -1);
                 }
                 // Split potentially multiple arguments, respecting quotes within them
                 const remainingArgsList = safeSplitOutsideQuotes(cleanedArgs, ',');
                 remainingArgsList.forEach(arg => {
                     const trimmedArg = arg.trim();
                     if (trimmedArg) {
                         reformatted_line_parts.push(trimmedArg);
                     }
                 });
             }

             // Join parts with 4 spaces for RF alignment
             testCaseLines.push("    " + reformatted_line_parts.join('    '));

        } else {
             // Fallback for lines not matching method pattern (less common)
             // Python code joins with '    ' and indents with '        '
              if (!testCaseDefined) { // Ensure test case name is added if not already
                  testCaseLines.push(currentTestCaseName);
                  testCaseDefined = true;
              }
             testCaseLines.push("    " + commandParts.join('    '));
        }
    }

    // --- Teardown ---
    // Python: if context_close_found: adds Close Context, Close Browser
     // Add teardown steps only if some actions were actually written
     if (writingStarted) {
          if (!testCaseDefined) { // Ensure test case name is added if not already
             testCaseLines.push(currentTestCaseName);
             testCaseDefined = true;
          }
          const lastStep = testCaseLines[testCaseLines.length - 1]?.trim();
         // Check if teardown isn't already added
         if (!lastStep || (!lastStep.startsWith('Close Context') && !lastStep.startsWith('Close Browser'))) {
             if (contextCloseFound) { // Add Close Context only if explicitly found
                 testCaseLines.push("    Close Context");
             }
             // Always add Close Browser if writing started and it wasn't explicitly closed
             if (!lastStep || !lastStep.startsWith('Close Browser')) {
                  testCaseLines.push("    Close Browser");
             }
         }
     }


    // Combine sections
    // Python: final_output = "\n".join(output_lines + variable_lines + test_case_lines)
    const final_output_lines = [
        ...outputLines,
        '', // Add empty line between sections
        ...variableLines,
        '', // Add empty line between sections
        ...testCaseLines
    ];

    const final_output = final_output_lines.join('\n');
    // Python applies align_robot_test_cases at the end
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
            // Use the translated conversion function based on the latest Python logic
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
                     // Use the translated conversion function based on the latest Python logic
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
        // Check for common API key or permission errors by inspecting the message
        // This provides a more user-friendly message for configuration issues
        if (error.message?.toLowerCase().includes('api key') || error.message?.toLowerCase().includes('permission denied')) {
            detailedErrorMessage = 'The chatbot is still under development. Please cooperate.';
            console.error('Potential API Key or Permission Issue Detected.');
        } else if (error.message?.includes('quota')) {
            detailedErrorMessage = 'The chatbot service is currently experiencing high traffic. Please try again later.';
            console.error('Potential Quota Issue Detected.');
        } else if (error.message?.toLowerCase().includes('model not found') || error.message?.toLowerCase().includes('invalid model')) {
             detailedErrorMessage = 'The chatbot model configuration is incorrect. Please contact support.';
             console.error('Chatbot Model Configuration Error Detected.');
        }
        console.error('Error Stack:', error.stack);
    } else {
        console.error('Unknown error object:', error);
    }
    // Return a user-friendly but informative message
    return detailedErrorMessage + ' (See server logs for details)';
  }
}
