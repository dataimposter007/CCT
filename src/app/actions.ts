'use server';

import type { z } from 'zod';
import * as zod from 'zod'; // Ensure z is imported
import * as xlsx from 'xlsx'; // For reading Excel files
import AdmZip from 'adm-zip'; // For creating zip files

// --- Helper Functions (Adapted for Buffers/File Objects) ---

/**
 * Splits a string by a delimiter, respecting quotes.
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
 * @param fileBuffer Buffer containing the Excel file content.
 * @param fileName Original filename (for error messages).
 * @param sheetName Name of the sheet containing the mapping.
 * @returns A dictionary mapping Playwright methods to Robot keywords.
 */
async function loadMappingFromExcel(fileBuffer: Buffer, fileName: string, sheetName: string): Promise<{ [key: string]: string }> {
    try {
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' }); // Read from buffer
        if (!workbook.SheetNames.includes(sheetName)) {
             throw new Error(`Sheet "${sheetName}" not found in ${fileName}. Available sheets: ${workbook.SheetNames.join(', ')}`);
        }
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
             // This case should ideally be caught by the check above, but adding for robustness
             throw new Error(`Sheet "${sheetName}" could not be loaded from ${fileName}`);
        }
        const jsonData = xlsx.utils.sheet_to_json<{
            Actual_core_python_playwright_methods: string;
            browser_library_keyword: string;
        }>(worksheet);

        const mapping: { [key: string]: string } = {};
        jsonData.forEach(row => {
            const playwrightMethod = row.Actual_core_python_playwright_methods?.toString().trim();
            const robotKeyword = row.browser_library_keyword?.toString().trim();
            if (playwrightMethod && robotKeyword) {
                mapping[playwrightMethod] = robotKeyword;
            }
        });
         if (Object.keys(mapping).length === 0) {
             console.warn(`Mapping loaded from sheet "${sheetName}" in ${fileName} is empty. Check column names ('Actual_core_python_playwright_methods', 'browser_library_keyword') and data.`);
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
 * @param method_name The Playwright method signature (e.g., "click()").
 * @param mapping The mapping dictionary.
 * @returns The corresponding Robot keyword or the original method name if no match found.
 */
function findNearestMatch(method_name: string, mapping: { [key: string]: string }): string {
    for (const key in mapping) {
        // Exact match first
        if (typeof key === 'string' && key === method_name) {
             return mapping[key];
        }
        // Then check if method_name (like 'click()') is a substring of the key (like 'locator(...).click()')
         if (typeof key === 'string' && key.includes(method_name)) {
             return mapping[key];
         }
    }
    // Fallback if no key contains the method_name as a substring
     // If still no match, return a placeholder indicating conversion needed
     // console.warn(`No direct or substring match found for method: ${method_name}. Using original.`);
     // Basic transformation for common methods if not in mapping
    if (method_name === 'fill()') return 'Input Text';
    if (method_name === 'click()') return 'Click';
    if (method_name === 'press()') return 'Press Keys';
    if (method_name === 'goto()') return 'New Page'; // Added goto mapping
    if (method_name === 'select_option()') return 'Select Options By'; // Basic map for select
    if (method_name === 'check()') return 'Select Checkbox'; // Basic map
    if (method_name === 'uncheck()') return 'Unselect Checkbox'; // Basic map
    // Add more basic fallbacks if necessary
    return method_name.replace(/\(\)/, ''); // Return the base name if absolutely no match
}


/**
 * Extracts a locator string suitable for Robot Framework from Playwright locator text.
 * Handles ID selectors (#), name attributes, and quoted strings.
 * @param locator_text The raw locator text from Playwright code (e.g., 'locator("#myId")', 'get_by_role("button", name="Submit")').
 * @returns A formatted locator string (e.g., "id=myId", '"Submit"', '"some text"').
 */
function extractLocator(locator_text: string): string {
     // Handle common Playwright locators and convert to Robot Framework syntax
     // page.locator('#id') -> id=id
     let match = locator_text.match(/\.locator\(['"]#([^'"]+)['"]\)/);
     if (match) return `id=${match[1]}`;

     // page.locator('.class') -> css=.class
     match = locator_text.match(/\.locator\(['"]\.([^'"]+)['"]\)/);
     if (match) return `css=.${match[1]}`;

     // page.locator('xpath=...') -> xpath=...
     match = locator_text.match(/\.locator\(['"](xpath=[^'"]+)['"]\)/);
     if (match) return match[1];

     // page.locator('css=...') or page.locator('...') -> css=...
     match = locator_text.match(/\.locator\(['"](css=)?([^'"]+)['"]\)/);
     if (match) return `css=${match[2]}`; // Assume CSS if not specified otherwise

     // page.get_by_role('button', { name: 'Submit' }) -> role=button[name="Submit"] (or similar)
     // Robot's Browser library selector strategy might vary. Let's try a common one.
     match = locator_text.match(/get_by_role\(['"]([^'"]+)['"](?:,\s*\{?\s*name:\s*['"]([^'"]+)['"]\s*\}?)?\)/);
     if (match) {
         const role = match[1];
         const name = match[2];
         return name ? `role=${role}[name="${name}"]` : `role=${role}`;
     }

      // page.get_by_label('Password') -> label=Password
     match = locator_text.match(/get_by_label\(['"]([^'"]+)['"]\)/);
     if (match) return `label=${match[1]}`;

     // page.get_by_placeholder('Email') -> placeholder=Email
     match = locator_text.match(/get_by_placeholder\(['"]([^'"]+)['"]\)/);
     if (match) return `placeholder=${match[1]}`;

     // page.get_by_text('Sign in') -> text=Sign in
     match = locator_text.match(/get_by_text\(['"]([^'"]+)['"](?:,\s*\{?\s*exact:\s*(true|false)\s*\}?)?\)/);
     if (match) {
        // RF 'text=' is substring match by default. If exact=true, need different handling or keep as is.
        return `text=${match[1]}`;
     }

     // page.get_by_title('Issues') -> title=Issues
     match = locator_text.match(/get_by_title\(['"]([^'"]+)['"]\)/);
     if (match) return `title=${match[1]}`;

     // page.get_by_test_id('submit-button') -> data-testid=submit-button
     match = locator_text.match(/get_by_test_id\(['"]([^'"]+)['"]\)/);
     if (match) return `data-testid=${match[1]}`;

     // Fallback: If it looks like a simple string, assume it's a CSS selector or text
      match = locator_text.match(/^['"]([^'"]+)['"]$/);
       if (match && !locator_text.includes('(')) { // Avoid matching function calls like "click()"
           const potentialLocator = match[1];
            // Simple check for common CSS/XPath chars or if it's likely text
            if (potentialLocator.includes('.') || potentialLocator.includes('#') || potentialLocator.includes('[') || potentialLocator.includes('/') || potentialLocator.includes('>')) {
                return `css=${potentialLocator}`; // Assume CSS or XPath
            } else {
                // It might be text content, but RF needs explicit strategy
                return `text=${potentialLocator}`; // Default to text selector
            }
       }

    // Final fallback: return original wrapped in quotes if no specific pattern matches
    return `"${locator_text}"`;
}

/**
 * Aligns Robot Framework test case steps with standard indentation.
 * @param inputContent The raw content of the .robot file.
 * @returns Formatted content string.
 */
function alignRobotCode(inputContent: string): string {
    const lines = inputContent.split('\n');
    const formattedLines: string[] = [];
    let inSection = ''; // '', 'Settings', 'Variables', 'Test Cases', 'Keywords'
    const indent = '    '; // 4 spaces

    for (const line of lines) {
        const strippedLine = line.trim();

        // Detect section headers and keep them as is
        if (strippedLine.startsWith('***') && strippedLine.endsWith('***')) {
            const sectionMatch = strippedLine.match(/^\*\*\* (Settings|Variables|Test Cases|Keywords) \*\*\*$/);
            inSection = sectionMatch ? sectionMatch[1] : ''; // Update current section
            formattedLines.push(line.trim()); // Add trimmed section header
            continue;
        }

        // Handle blank lines and comments
        if (!strippedLine || strippedLine.startsWith('#')) {
            formattedLines.push(line); // Keep original line including whitespace/comment char
            continue;
        }

        // Apply indentation based on section
        switch (inSection) {
            case 'Settings':
            case 'Variables':
                 // Settings (Library, Resource, etc.) and Variables typically start at column 0 or have 2 spaces
                 if (line.match(/^\S/)) { // Starts with non-space
                     formattedLines.push(strippedLine);
                 } else {
                      // Keep original relative indentation for now, but ensure at least 2 spaces if indented
                      const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0;
                      if (leadingSpaces > 0 && leadingSpaces < 2) {
                          formattedLines.push(`  ${strippedLine}`);
                      } else {
                           formattedLines.push(line); // Keep if already > 2 spaces or starts with non-space
                      }
                 }
                break;
            case 'Test Cases':
            case 'Keywords':
                // Test case/Keyword name (no indent) or step (4 spaces)
                if (line.match(/^\S/) && !line.startsWith(indent)) { // Starts with non-space, not already indented
                    formattedLines.push(strippedLine); // Test case or Keyword name
                } else {
                    // Ensure step is indented with 4 spaces
                    formattedLines.push(`${indent}${strippedLine}`);
                }
                break;
            default:
                // Outside any known section, keep original line for safety
                formattedLines.push(line);
                break;
        }
    }

    // Ensure blank line between sections for readability
    const finalLines: string[] = [];
    let lastLineWasSectionHeader = false;
    for (let i = 0; i < formattedLines.length; i++) {
        const currentLine = formattedLines[i];
        const isSectionHeader = currentLine.trim().startsWith('***');

        if (isSectionHeader && i > 0 && !lastLineWasSectionHeader && finalLines[finalLines.length - 1].trim() !== '') {
             finalLines.push(''); // Add blank line before new section if needed
        }
        finalLines.push(currentLine);
        lastLineWasSectionHeader = isSectionHeader;
    }


    return finalLines.join('\n').replace(/\n{3,}/g, '\n\n'); // Collapse excessive blank lines
}



/**
 * Converts a single Playwright Python script content to Robot Framework format.
 * @param inputCode The content of the Python script.
 * @param mapping The Playwright-to-Robot keyword mapping.
 * @returns The generated Robot Framework code as a string.
 */
function convertSinglePlaywrightCode(inputCode: string, mapping: { [key: string]: string }): string {
    const outputLines = ["*** Settings ***", "Library    Browser"];
    const variableLines = ["*** Variables ***", "${BROWSER}    chromium"]; // Default to chromium
    const testCaseLines: string[] = ["*** Test Cases ***"];
    let urlCounter = 1;
    const urlMapping: { [key: string]: string } = {};
    let writingStarted = false;
    let firstGoto = true;
    let variableCounter = 1;
    let contextCloseFound = false;
    let browserCloseFound = false;
    let currentTestCaseName = "Converted Playwright Test"; // Default test case name
    let insideTestCase = false; // Track if we are inside a *** Test Cases *** section step generation


    const rawLines = inputCode.split("\n");
    let lines: string[] = [];


     // Pre-process for page.once('dialog', ...) - Keep this simple for now
    rawLines.forEach(line => {
        const stripped = line.trim();
        if (stripped.includes("page.once('dialog'") && stripped.includes("lambda dialog: dialog.")) {
            const action = stripped.includes("dialog.accept()") ? 'Accept' : 'Dismiss'; // Use RF keywords
            lines.push(`    # INFO: Playwright page.once('dialog',...) converted. Ensure the action below triggers the dialog.`);
             lines.push(`    Handle Future Dialog    action=${action}`); // Browser library keyword
             // Avoid adding placeholder comments that might confuse users
        } else {
            lines.push(line);
        }
    });


    for (const line of lines) {
        const stripped_line = line.trim();
        if (!stripped_line || stripped_line.startsWith('#')) {
            continue; // Skip empty lines and comments
        }

         // --- Logic from Python code ---
          if (stripped_line.includes("context.close()")) {
             contextCloseFound = true;
             // Don't break; continue processing other lines. Add RF step later.
             continue;
         }
          if (stripped_line.includes("browser.close()")) {
             browserCloseFound = true;
             // Don't break; continue processing. Add RF step later.
             continue;
         }


       if (stripped_line.startsWith("def test_")) {
            const match = stripped_line.match(/def (test_\w+)\(/);
            if (match) {
                currentTestCaseName = match[1].replace(/_/g, ' ').replace(/^test /, ''); // Make it more readable
                currentTestCaseName = currentTestCaseName.charAt(0).toUpperCase() + currentTestCaseName.slice(1); // Capitalize
                if (insideTestCase) { // If already in a test case, add teardown for previous IF NEEDED
                    // We add teardown globally at the end now, simplifying this
                } else {
                    insideTestCase = true; // Mark that we've entered the first test case section
                }
                testCaseLines.push(`${currentTestCaseName}`); // Add Test Case Name
                firstGoto = true; // Reset New Page/New Context for the new test case
            }
            continue; // Don't process the 'def test_...' line itself
        }

        // Start processing only if inside a test case definition
        if (!insideTestCase) continue;


        // Handle expect() assertions - More robust handling
        if (stripped_line.startsWith("expect(")) {
             let locator = 'css=body'; // Default
             const locatorMatch = stripped_line.match(/expect\(page\.(locator|get_by_.*?)\((.*?)\)\)/);
             if (locatorMatch) {
                  // Reconstruct the locator part for extraction
                 const locatorCall = `page.${locatorMatch[1]}(${locatorMatch[2]})`;
                 locator = extractLocator(locatorCall);
             } else {
                 // Handle cases like expect(page).to_have_url(...)
                 const pageExpectMatch = stripped_line.match(/expect\(page\)/);
                 if (!pageExpectMatch) {
                      console.warn("Could not extract locator from expect:", stripped_line);
                      testCaseLines.push(`    # TODO: Convert Playwright assertion (locator unclear): ${stripped_line}`);
                      continue;
                 }
                 // Locator isn't applicable for page-level asserts like URL/Title
             }


             // to_contain_text / to_have_text (often similar in RF)
             const textMatch = stripped_line.match(/\.to_(?:contain|have)_text\((?:'|")(.*?)(?:'|")\)/);
             if (textMatch) {
                  const expectedText = textMatch[1];
                  if (locator !== 'css=body') {
                      testCaseLines.push(`    Page Should Contain Text    ${locator}    ${expectedText}`); // Use specific locator
                  } else {
                      testCaseLines.push(`    Page Should Contain    ${expectedText}`); // General page check
                  }
                  continue;
             }

             // to_be_visible
             if (stripped_line.includes(".to_be_visible()")) {
                 if (locator !== 'css=body') {
                     testCaseLines.push(`    Wait For Elements State    ${locator}    visible`); // Default timeout handled by library
                 } else {
                      testCaseLines.push(`    # INFO: 'expect(page).to_be_visible()' is implicit in RF actions.`);
                 }
                 continue;
             }
             // to_be_hidden / not_to_be_visible
             if (stripped_line.includes(".to_be_hidden()") || stripped_line.includes(".not_to_be_visible()")) {
                  if (locator !== 'css=body') {
                      testCaseLines.push(`    Wait For Elements State    ${locator}    hidden`);
                  } else {
                       testCaseLines.push(`    # WARNING: 'expect(page).to_be_hidden()' is not directly translatable.`);
                  }
                 continue;
             }

             // to_have_url
             const urlMatch = stripped_line.match(/\.to_have_url\((?:'|")(.*?)(?:'|")\)/);
             if (urlMatch) {
                  testCaseLines.push(`    Location Should Be    ${urlMatch[1]}`);
                  continue;
             }

             // to_have_title
             const titleMatch = stripped_line.match(/\.to_have_title\((?:'|")(.*?)(?:'|")\)/);
             if (titleMatch) {
                  testCaseLines.push(`    Title Should Be    ${titleMatch[1]}`);
                  continue;
             }

             // to_have_attribute
             const attrMatch = stripped_line.match(/\.to_have_attribute\((?:'|")(.*?)(?:'|"),\s*(?:'|")(.*?)(?:'|")\)/);
              if (attrMatch && locator !== 'css=body') {
                 testCaseLines.push(`    Element Should Have Attribute    ${locator}    ${attrMatch[1]}    ${attrMatch[2]}`);
                 continue;
              }


             // Add more expect() conversions here...
             testCaseLines.push(`    # TODO: Convert Playwright assertion: ${stripped_line}`);
             continue;
        }


        // Handle page.goto() -> New Page or Go To
        if (stripped_line.includes('.goto(')) {
            const url_match = stripped_line.match(/\(['"]([^'"]+)['"]\)/);
            if (url_match) {
                const url = url_match[1];
                let var_name = urlMapping[url];
                 // Define URL variables if not already defined
                 if (!var_name && !url.startsWith('http')) { // Don't create variables for relative paths usually
                     // Avoid creating variables for simple URLs unless complex
                 } else if (!var_name) {
                    var_name = `\${URL${urlCounter}}`;
                    urlMapping[url] = var_name;
                    variableLines.push(`${var_name}    ${url}`);
                    urlCounter++;
                 }

                if (firstGoto) {
                    // Add setup steps for the *first* goto in a test case
                    testCaseLines.push(`    New Browser    browser=${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'chromium'}    headless=False`); // Reference variable if defined
                    testCaseLines.push(`    New Context    viewport={'width': 1920, 'height': 1080}`);
                     // Use New Page for the first navigation
                     testCaseLines.push(`    New Page    ${var_name || url}`);
                    firstGoto = false; // Setup done for this test case
                } else {
                     // Subsequent navigations use Go To
                     testCaseLines.push(`    Go To    ${var_name || url}`);
                }
            }
            continue; // Move to next line after handling goto
        }

         // --- General Method Conversion ---
        // Use safe split for complex lines like page.locator(...).first.click()
         const parts = safeSplitOutsideQuotes(stripped_line, '.');
         const commandParts = parts.map(part => part.trim()).filter(part => part);

         if (commandParts.length < 2 || !commandParts[0].includes('page')) { // Basic check if it's a page action
             // Could be other operations (e.g., variable assignments, non-Playwright calls)
              // Let's try to preserve non-action lines as comments or basic keywords if possible
               if (!stripped_line.includes('(') && stripped_line.includes('=')) {
                  // Likely variable assignment, attempt basic RF conversion
                  const assignParts = stripped_line.split('=');
                  const varName = assignParts[0].trim();
                  const value = assignParts[1].trim();
                  testCaseLines.push(`    \${${varName}} =    Set Variable    ${value}`);
               } else {
                 testCaseLines.push(`    # INFO: Skipped non-Playwright action line: ${line.trim()}`);
               }
              continue;
         }


         // Identify the action (last part) and locator chain (parts before action)
         let actionPart = commandParts[commandParts.length - 1];
         let locatorChainParts = commandParts.slice(0, -1);

          // Handle chained locators like .first(), .last(), .nth() - these modify the locator chain
          if (['first()', 'last()'].includes(actionPart) && locatorChainParts.length > 0) {
               // If the action is .first() or .last(), the *real* action is the one before it
               actionPart = locatorChainParts.pop()!; // The real action is now the last part of the chain
               // The locator chain remains the same (RF handles first/last implicitly or via index)
               // We might need to adjust the locator string later based on the keyword used
          } else if (actionPart.startsWith('nth(') && locatorChainParts.length > 0) {
               // Extract index from nth(index)
               const nthMatch = actionPart.match(/nth\((\d+)\)/);
               const index = nthMatch ? parseInt(nthMatch[1], 10) : 0;
               actionPart = locatorChainParts.pop()!; // The real action
               // TODO: Incorporate index into the locator string if possible/needed by RF keyword
               // For now, we might lose the nth specificity, needs keyword-specific handling.
               console.warn(`'.nth(${index})' specified, but Robot Framework conversion might not preserve exact index for action '${actionPart}'. Locator: ${locatorChainParts.join('.')}`);
          }


         const actionMatch = actionPart.match(/^([a-zA-Z_]+)\((.*)\)$/);
         if (actionMatch) {
             const method_name_only = actionMatch[1];
             const method_name_signature = `${method_name_only}()`; // For mapping lookup
             let method_args_raw = actionMatch[2]?.trim() ?? ''; // Ensure args is a string

             // Find the corresponding Robot Framework keyword
             const transformed_method = findNearestMatch(method_name_signature, mapping);

             // Construct the locator string from the (potentially modified) locator chain
             let locator_text = '';
             if (locatorChainParts.length > 0) {
                 // Reconstruct the full locator call string (e.g., "page.get_by_role(...).locator(...)")
                 const rawLocatorChain = locatorChainParts.join('.');
                 locator_text = extractLocator(rawLocatorChain); // Extract RF compatible locator
             } else if (transformed_method !== 'New Page' && transformed_method !== 'Go To' && transformed_method !== 'Close Browser' && transformed_method !== 'Close Context') {
                // If there's no locator chain, but the method requires one (like Click, Input Text)
                 console.warn(`Action '${transformed_method}' used without a preceding locator in line: ${stripped_line}. Assuming 'css=body'.`);
                 locator_text = 'css=body'; // Default if action needs locator but none provided
             }


             // --- Argument Handling ---
              let finalArgs: string[] = [];
              if (method_args_raw) {
                  // Simple split by comma, but respect content within quotes/parentheses/braces
                  // This is a basic approach and might fail for complex nested structures.
                  const argParts = method_args_raw.match(/(?:[^,"'\(\[\{]+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\((?:[^)]|\(.*\))*\)|\[(?:[^\]]|\[.*\])*\]|\{(?:[^}]|\{.*\})*\})+/g) || [];

                  finalArgs = argParts.map(arg => {
                      arg = arg.trim();
                      // Keep quotes for string literals in Robot Framework
                      if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
                          return arg;
                      }
                      // Handle common Playwright args like { force: true } -> force=True (RF syntax)
                      if (arg === '{ force: true }') return 'force=True';
                       if (arg === '{ timeout: 5000 }') return 'timeout=5s'; // Convert ms to s
                       // Basic conversion for other objects - might need manual adjust
                       if (arg.startsWith('{') && arg.endsWith('}')) {
                           return arg.replace(/:\s*/g, '=') // Replace ':' with '='
                                     .replace(/true/g, 'True').replace(/false/g, 'False') // Python bools to RF
                                     .replace(/null/g, 'None'); // JS null to RF None
                       }
                      // Assume numbers or variables don't need quotes
                      if (!isNaN(Number(arg)) || arg.startsWith('${')) { // Check if numeric or RF variable
                          return arg;
                      }
                       // Otherwise, assume it's a string that needs quoting for RF
                      return `"${arg}"`;
                  });
              }

              // Combine parts into RF step: Keyword [Locator] [Arg1] [Arg2] ...
               const robotStepParts = [transformed_method];
               if (locator_text) {
                   robotStepParts.push(locator_text);
               }
               robotStepParts.push(...finalArgs);

              testCaseLines.push(`    ${robotStepParts.join('    ')}`); // Join with RF standard 4 spaces

         } else {
             // Line doesn't match the expected action pattern
             testCaseLines.push(`    # TODO: Could not parse action: ${actionPart} in line: ${line.trim()}`);
         }
    }


     // Add teardown steps if they were found in the script
     // Ensure they are added only once at the end of the last test case implicitly defined
     if (contextCloseFound) {
          if (!testCaseLines[testCaseLines.length - 1].trim().startsWith('Close Context')) {
              testCaseLines.push("    Close Context");
          }
     }
      if (browserCloseFound) {
           if (!testCaseLines[testCaseLines.length - 1].trim().startsWith('Close Browser') &&
               !(testCaseLines.length > 1 && testCaseLines[testCaseLines.length - 2].trim().startsWith('Close Browser'))) { // Check previous line too
               testCaseLines.push("    Close Browser");
           }
      }
      // Add default teardown if no close actions were explicitly found
       else if (insideTestCase && !contextCloseFound && !browserCloseFound) {
           // Add default teardown only if a test case was actually started
           testCaseLines.push("    Close Context");
           testCaseLines.push("    Close Browser");
       }


    const final_output = [...outputLines, '', ...variableLines, '', ...testCaseLines].join('\n');
    return alignRobotCode(final_output); // Align the generated code
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
             // Warning added in loadMappingFromExcel, can decide if error needed here
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
        // Cleanup logic if needed (e.g., temp files, though not used currently)
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
