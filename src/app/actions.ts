
'use server';

import type { z } from 'zod';
import * as zod from 'zod';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as xlsx from 'xlsx'; // For reading Excel files
import AdmZip from 'adm-zip'; // For creating zip files

// --- Helper Functions (Translated from Python) ---

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
 * Loads the mapping from a specific sheet in an Excel file.
 * @param filePath Path to the Excel file.
 * @param sheetName Name of the sheet containing the mapping.
 * @returns A dictionary mapping Playwright methods to Robot keywords.
 */
async function loadMappingFromExcel(filePath: string, sheetName: string = 'Sheet1'): Promise<{ [key: string]: string }> {
    try {
        const workbook = xlsx.readFile(filePath);
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
            throw new Error(`Sheet "${sheetName}" not found in ${filePath}`);
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
        return mapping;
    } catch (error: any) {
        console.error(`Error loading mapping from Excel: ${error.message}`);
        throw new Error(`Failed to load mapping from ${path.basename(filePath)}: ${error.message}`);
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
    // Handle ID selector: locator('#myId') -> id=myId
    if (locator_text.includes('.locator(')) {
        const idMatch = locator_text.match(/\.locator\(['"]#([^'"]+)['"]\)/);
        if (idMatch) {
            return `id=${idMatch[1]}`;
        }
    }

    // Handle get_by_role with name: get_by_role("button", name="Submit") -> "Submit" (might need adjustment based on Robot keyword)
    // For keywords like Click, Input Text, etc., the locator is often the primary argument.
    // Let's refine this to extract the most likely locator part.
    const nameMatch = locator_text.match(/name=['"]([^'"]+)['"]/);
    if (nameMatch) {
        return `"${nameMatch[1]}"`; // Return the name attribute value quoted
    }

     // Handle simple quoted locators like page.locator('"my-selector"')
     const quotedMatchSimple = locator_text.match(/\(['"]([^'"]+)['"]\)/);
     if (quotedMatchSimple && !locator_text.includes(',')) { // Ensure it's just the locator
        // Check if it looks like a CSS selector or XPath
        const potentialLocator = quotedMatchSimple[1];
        if (potentialLocator.startsWith('/') || potentialLocator.includes('[') || potentialLocator.includes('.') || potentialLocator.includes('#') || potentialLocator.includes('>')) {
            return potentialLocator; // Assume CSS or XPath if it has common symbols
        } else {
            return `"${potentialLocator}"`; // Otherwise, quote it
        }
     }

    // Handle get_by_text: get_by_text("Welcome") -> "Welcome"
    const textMatch = locator_text.match(/get_by_text\(['"]([^'"]+)['"]\)/);
    if (textMatch) {
        return `"${textMatch[1]}"`; // Return the text quoted
    }

    // Fallback: Try to extract anything within the *last* set of parentheses and quotes
    const fallbackMatch = locator_text.match(/.*\(['"]([^'"]+)['"]\)/);
    if (fallbackMatch) {
        return `"${fallbackMatch[1]}"`;
    }


    // Final fallback: return the original text quoted if no specific pattern matches
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

    for (const line of lines) {
        const strippedLine = line.trim();

        // Detect section headers
        if (strippedLine.startsWith('*** ')) {
            const sectionMatch = strippedLine.match(/^\*\*\* (Settings|Variables|Test Cases|Keywords) \*\*\*$/);
            if (sectionMatch) {
                inSection = sectionMatch[1];
                formattedLines.push(line); // Keep the section header as is
                continue;
            } else {
                 // Handle potentially invalid section headers or comments that look like headers
                 inSection = ''; // Reset section if header is malformed
                 formattedLines.push(line); // Keep the line
                 continue;
            }
        }

        // Handle blank lines and comments
        if (!strippedLine || strippedLine.startsWith('#')) {
            formattedLines.push(line);
            continue;
        }

        // Apply indentation based on section
        switch (inSection) {
            case 'Test Cases':
                // Test case name (no indentation) or step (4 spaces)
                if (line.match(/^\S/) && !line.match(/^ {4}/)) { // Line starts with non-space, assume it's a test case name
                     formattedLines.push(line); // Test case name
                } else {
                     formattedLines.push(`    ${strippedLine}`); // Test step
                }
                break;
            case 'Keywords':
                 // Keyword name (no indentation) or step (4 spaces)
                 if (line.match(/^\S/) && !line.match(/^ {4}/)) { // Line starts with non-space, assume it's a keyword name
                      formattedLines.push(line); // Keyword name
                 } else {
                      formattedLines.push(`    ${strippedLine}`); // Keyword step
                 }
                break;
            case 'Variables':
            case 'Settings':
                // Lines in Variables and Settings usually start at the beginning or have specific indentation
                 formattedLines.push(line); // Keep original indentation for these sections for now
                break;
            default:
                // Outside any known section, keep original line
                formattedLines.push(line);
                break;
        }
    }

    return formattedLines.join('\n');
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
    let writingStarted = false; // Start writing test steps only after the first page.goto
    let firstGoto = true;
    let variableCounter = 1;
    let contextCloseFound = false;
    let currentTestCaseName = "Converted Playwright Test"; // Default test case name
    let insideTestCase = false; // Track if we are inside a *** Test Cases *** section step generation


    const rawLines = inputCode.split("\n");
    let lines: string[] = [];


     // Pre-process for page.once('dialog', ...)
    rawLines.forEach(line => {
        const stripped = line.trim();
        // Handle page.once('dialog', lambda dialog: dialog.accept()) or dismiss()
        if (stripped.includes("page.once('dialog'") && stripped.includes("lambda dialog: dialog.")) {
            const action = stripped.includes("dialog.accept()") ? 'accept' : 'dismiss';
            // Heuristic: Add Promise To keyword before the line *likely* triggering the dialog
            // This requires the user to potentially adjust the order.
            lines.push(`    # INFO: The following Playwright line was converted to handle a dialog:`);
            lines.push(`    # ${stripped}`);
            lines.push(`    ${action === 'accept' ? 'Promise To    Handle Future Dialog    action=accept' : 'Promise To    Handle Future Dialog    action=dismiss'}`);
             lines.push(`    # TODO: Place the action that triggers the dialog (e.g., Click) *after* this line.`);
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
            // Don't break immediately, let loop finish to potentially add teardown
            continue; // Skip this line for direct conversion
        }


       if (stripped_line.startsWith("def test_")) {
            const match = stripped_line.match(/def (test_\w+)\(/);
            if (match) {
                currentTestCaseName = match[1].replace(/_/g, ' ').replace(/^test /, ''); // Make it more readable
                currentTestCaseName = currentTestCaseName.charAt(0).toUpperCase() + currentTestCaseName.slice(1); // Capitalize
                if (insideTestCase) { // If already in a test case, start a new one implicitly
                     // Add teardown for the previous case if context wasn't closed explicitly
                     if (!contextCloseFound) {
                        testCaseLines.push("        Close Context");
                        testCaseLines.push("        Close Browser");
                     }
                     contextCloseFound = false; // Reset for the new test case
                     firstGoto = true; // Reset for New Page in the new test case
                }
                testCaseLines.push(`${currentTestCaseName}`); // Add Test Case Name
                insideTestCase = true; // We are now starting steps for this test case
            }
            continue;
        }


        // Handle expect() assertions
        if (stripped_line.startsWith("expect(")) {
             if (!insideTestCase) continue; // Ignore expects outside a test case definition

             // Basic locator extraction (improve as needed)
            let locator = 'css=body'; // Default locator if none found
            const locatorMatch = stripped_line.match(/page\.(locator|get_by_.*?)\((.*?)\)/);
             if (locatorMatch) {
                 locator = extractLocator(locatorMatch[2].split(',')[0].trim()); // Extract first arg as locator
             }

             // to_contain_text
            const containTextMatch = stripped_line.match(/\.to_contain_text\("([^"]+)"\)/);
            if (containTextMatch) {
                testCaseLines.push(`    Page Should Contain    ${containTextMatch[1]}`);
                continue;
            }

            // to_be_visible
            const visibleMatch = stripped_line.match(/\.to_be_visible\(/);
            if (visibleMatch && locator !== 'css=body') {
                testCaseLines.push(`    Wait For Elements State    ${locator}    visible    timeout=10s`);
                continue;
            }

             // to_have_text (similar to contain_text for Robot)
            const haveTextMatch = stripped_line.match(/\.to_have_text\("([^"]+)"\)/);
             if (haveTextMatch && locator !== 'css=body') {
                 // Use Get Text and Should Be Equal for exact match assertion
                 testCaseLines.push(`    ${variable_name} =    Get Text    ${locator}`);
                 testCaseLines.push(`    Should Be Equal As Strings    ${variable_name}    ${haveTextMatch[1]}`);
                 continue;
             }

            // Add more expect() conversions here (e.g., to_have_attribute, to_be_enabled)
            testCaseLines.push(`    # TODO: Convert Playwright assertion: ${stripped_line}`);
            continue;
        }


        // Handle page.goto()
        if (stripped_line.includes('.goto("')) {
            writing_started = true;
            if (!insideTestCase) { // If not explicitly in a test case, start a default one
                testCaseLines.push("Default Converted Test Case");
                insideTestCase = true;
            }
            if (firstGoto) {
                // Add setup steps for the *first* goto in a test case
                testCaseLines.push("    New Browser    ${BROWSER}    headless=False"); // Add headless=False for visibility during testing
                testCaseLines.push("    New Context    viewport={'width': 1920, 'height': 1080}");
                firstGoto = false; // Setup done for this test case
            }

            const url_match = stripped_line.match(/\("([^"]+)"\)/);
            if (url_match) {
                const url = url_match[1];
                let var_name = urlMapping[url];
                if (!var_name) {
                    var_name = `\${URL${urlCounter}}`;
                    urlMapping[url] = var_name;
                    variableLines.push(`${var_name}    ${url}`);
                    urlCounter++;
                }
                testCaseLines.push(`    New Page    ${var_name}`); // Use New Page for goto
            }
            continue;
        }

        if (!writing_started) {
            continue; // Don't process lines before the first goto
        }

        // Handle browser.close() - less common in individual tests, usually in setup/teardown
        if (stripped_line.includes("browser.close()")) {
            // This is typically handled by Close Browser in teardown
            continue; // Skip direct conversion, rely on teardown
        }

        // --- General Method Conversion ---
        // Use safe split to handle potential arguments with dots inside quotes
        const parts = safeSplitOutsideQuotes(stripped_line, '.');
        const commandParts = parts.map(part => part.trim()).filter(part => part);

        if (commandParts.length < 2) {
            // Not a standard page.locator(...).action() chain
             testCaseLines.push(`    # Could not convert line: ${line.trim()}`);
             continue;
        }

        // Assume the last part is the action, e.g., "click()", "fill('text')"
         const actionPart = commandParts[commandParts.length - 1];
         // Assume parts before the last are the locator chain, e.g., ["page", "locator('#id')"]
         const locatorParts = commandParts.slice(0, -1); // Includes 'page' or similar base object

         const actionMatch = actionPart.match(/^([a-zA-Z_]+)\((.*)\)$/);
         if (actionMatch) {
             const method_name_only = actionMatch[1];
             const method_name_signature = `${method_name_only}()`; // For mapping lookup
             let method_args = actionMatch[2].trim();

             const transformed_method = findNearestMatch(method_name_signature, mapping);

              // Construct the locator string from parts before the action
              // Example: page.get_by_role("button", name="Login").click()
              // locatorParts = ["page", "get_by_role(\"button\", name=\"Login\")"]
              // We need to extract the core locator part for Robot keywords
              let locator_text = 'css=body'; // Default locator
              if (locatorParts.length > 1) {
                    // Join parts potentially containing nested calls like get_by_role, locator
                    const rawLocatorChain = locatorParts.slice(1).join('.'); // Join back parts after 'page'
                    locator_text = extractLocator(rawLocatorChain);
              }


             // Handle specific methods
             if (method_name_only === "select_option") {
                 let args = method_args;
                  // Robot uses 'Select Options By' keyword which is more flexible
                  // Determine if args are values, labels, or indices
                  let strategy = 'Value'; // Default guess
                  if (args.startsWith('{') && args.includes('label:')) strategy = 'Label';
                  if (args.startsWith('{') && args.includes('index:')) strategy = 'Index';

                  // Clean up args: remove braces, quotes around label/value keys
                   args = args.replace(/[{}[\]]/g, '').replace(/label:\s*/, '').replace(/value:\s*/, '').replace(/index:\s*/, '').trim();
                    // Remove surrounding quotes if present
                   if (args.startsWith('"') && args.endsWith('"')) args = args.slice(1, -1);
                   if (args.startsWith("'") && args.endsWith("'")) args = args.slice(1, -1);


                 // Reformat for Robot Framework: Select Options By    locator    strategy    *values
                 testCaseLines.push(`    Select Options By    ${locator_text}    ${strategy}    ${args}`);

             } else if (method_name_only === 'check' || method_name_only === 'uncheck') {
                 const actionKeyword = method_name_only === 'check' ? 'Checkbox Should Be Selected' : 'Checkbox Should Not Be Selected';
                 // Robot uses assertion keywords for checking state after an action.
                 // If Playwright 'check' implies clicking, we need a 'Click' then assertion.
                 // Assuming 'check'/'uncheck' in Playwright *sets* the state if needed:
                 const desiredState = method_name_only === 'check';
                 testCaseLines.push(`    ${desiredState ? 'Select Checkbox' : 'Unselect Checkbox'}    ${locator_text}`);

             } else if (method_args) {
                 // General case with arguments
                 // Clean arguments: remove surrounding quotes for simple strings
                 if (method_args.startsWith('"') && method_args.endsWith('"')) {
                     method_args = method_args.slice(1, -1);
                 } else if (method_args.startsWith("'") && method_args.endsWith("'")) {
                      method_args = method_args.slice(1, -1);
                 }
                  // Handle potential complex arguments (objects, multiple args) - may need manual refinement
                  // For now, pass the cleaned args string directly
                 testCaseLines.push(`    ${transformed_method}    ${locator_text}    ${method_args}`);
             } else {
                 // Method without arguments (like click)
                 testCaseLines.push(`    ${transformed_method}    ${locator_text}`);
             }
         } else {
             // Line doesn't match the expected action pattern
             testCaseLines.push(`    # Could not parse action: ${actionPart} in line: ${line.trim()}`);
         }

        // --- End Logic from Python code ---
    }

    // Add teardown steps if context wasn't explicitly closed
    if (insideTestCase && !contextCloseFound) {
        testCaseLines.push("    Close Context");
        testCaseLines.push("    Close Browser");
    } else if (insideTestCase && contextCloseFound) {
        // If context.close() was found, ensure Close Browser is also added if needed
        // Check if Close Browser was already added
         const lastLines = testCaseLines.slice(-2).join('\n');
         if (!lastLines.includes('Close Browser')) {
              testCaseLines.push("    Close Browser");
         }
    }

    const final_output = [...outputLines, ...variableLines, ...testCaseLines].join('\n');
    return alignRobotCode(final_output); // Align the generated code
}

// --- Server Action ---

const FormSchema = zod.object({
  mappingFile: zod.string().min(1, 'Mapping file path is required.')
     .refine(async (value) => {
        try {
            await fs.access(value, fs.constants.R_OK); // Check read access
            return true;
        } catch {
            return false;
        }
     }, { message: "Mapping file not found or not readable." }),
  inputFileOrFolder: zod.string().min(1, 'Input file/folder path is required.')
      .refine(async (value) => {
        try {
            await fs.access(value, fs.constants.R_OK); // Check read access
            return true;
        } catch {
            return false;
        }
      }, { message: "Input file or folder not found or not readable." }),
  isSingleFile: zod.boolean().default(false).optional(),
  outputFolder: zod.string().min(1, 'Output folder path is required.')
       .refine(async (value) => {
        try {
            // Attempt to get stats. If it fails because it doesn't exist, it's *potentially* okay
            // if the parent directory exists and we can create it.
            // However, for simplicity here, we check if it *exists* and is a *directory*.
            // A more robust check would verify write permissions in the parent if it doesn't exist.
            const stats = await fs.stat(value);
            return stats.isDirectory();
        } catch (error: any) {
             if (error.code === 'ENOENT') {
                // Check if parent directory exists and is writable
                const parentDir = path.dirname(value);
                try {
                    await fs.access(parentDir, fs.constants.W_OK);
                    return true; // Parent exists and is writable, so output dir can be created
                } catch {
                    return false; // Parent doesn't exist or isn't writable
                }
            }
            return false; // Other error (e.g., not a directory)
        }
       }, { message: "Output folder is not a valid directory or cannot be created." }),
});

type FormValues = zod.infer<typeof FormSchema>;

interface ConversionResult {
  success: boolean;
  message?: string;
  error?: string;
  fileName?: string; // Suggested filename for download (.robot or .zip)
  fileContent?: string; // Actual content for single file download
  zipBuffer?: Buffer; // Buffer for zip file download
}


async function performConversion(data: FormValues): Promise<ConversionResult> {
    console.log("Starting conversion with data:", data);
    const { mappingFile, inputFileOrFolder, isSingleFile, outputFolder } = data;
    const tempDir = path.join(os.tmpdir(), `conversion_${Date.now()}`); // Unique temp directory

    try {
         // 0. Create temporary directory for output files before zipping
         await fs.mkdir(tempDir, { recursive: true });

        // 1. Load Mapping
        const mapping = await loadMappingFromExcel(mappingFile);
        if (Object.keys(mapping).length === 0) {
            return { success: false, error: 'Mapping file is empty or invalid.' };
        }

        const inputSourceName = path.basename(inputFileOrFolder);
        const outputBaseName = inputSourceName.replace(/\.py$|\/$|\\$/, ''); // Remove .py extension or trailing slash


        if (isSingleFile) {
            // --- Single File Conversion ---
            const inputFile = inputFileOrFolder;
             const stats = await fs.stat(inputFile);
             if (!stats.isFile()) {
                 return { success: false, error: `Input path "${inputSourceName}" is not a file.` };
             }
             if (!inputFile.endsWith('.py')) {
                 return { success: false, error: `Input file "${inputSourceName}" must be a Python (.py) file.` };
             }

            const outputFileName = `${outputBaseName}_converted.robot`;
            const tempOutputPath = path.join(tempDir, outputFileName); // Save to temp dir first

            console.log(`Converting single file: ${inputFile} to ${tempOutputPath}`);

            const pythonCode = await fs.readFile(inputFile, 'utf-8');
            const robotCode = convertSinglePlaywrightCode(pythonCode, mapping);

             // Save the converted file temporarily (optional, could hold in memory)
             // await fs.writeFile(tempOutputPath, robotCode, 'utf-8');
             // console.log(`Saved temporary file: ${tempOutputPath}`);


             return {
                 success: true,
                 message: `Successfully converted file ${inputSourceName}. Output file is ready for download.`,
                 fileName: outputFileName,
                 fileContent: robotCode, // Return content directly
             };

        } else {
             // --- Folder Conversion ---
             const inputFolder = inputFileOrFolder;
              const stats = await fs.stat(inputFolder);
             if (!stats.isDirectory()) {
                 return { success: false, error: `Input path "${inputSourceName}" is not a directory.` };
             }

            console.log(`Converting folder: ${inputFolder}`);
            const files = await fs.readdir(inputFolder);
            const pythonFiles = files.filter(f => f.endsWith('.py'));

            if (pythonFiles.length === 0) {
                return { success: false, error: `No Python (.py) files found in folder "${inputSourceName}".` };
            }

            const outputZipFileName = `${outputBaseName}_robot_files.zip`;
             const zip = new AdmZip();

            for (const pyFile of pythonFiles) {
                const inputFile = path.join(inputFolder, pyFile);
                const outputFileName = pyFile.replace(/\.py$/, '_converted.robot');
                 const tempOutputPath = path.join(tempDir, outputFileName); // Output to temp dir

                try {
                    const pythonCode = await fs.readFile(inputFile, 'utf-8');
                    const robotCode = convertSinglePlaywrightCode(pythonCode, mapping);
                     await fs.writeFile(tempOutputPath, robotCode, 'utf-8'); // Write file to temp dir
                     zip.addLocalFile(tempOutputPath, '', outputFileName); // Add file from temp dir to zip root
                    console.log(`Converted and added to zip: ${pyFile} -> ${outputFileName}`);
                } catch (fileError: any) {
                    console.error(`Error converting file ${pyFile}: ${fileError.message}`);
                     // Optionally, add an error marker to the zip or return a partial success
                     zip.addFile(`${outputFileName}.ERROR.txt`, Buffer.from(`Failed to convert ${pyFile}: ${fileError.message}\n`, 'utf-8'));
                }
            }

            const zipBuffer = zip.toBuffer();
             console.log(`Created zip archive: ${outputZipFileName}`);


            return {
                success: true,
                message: `Successfully converted folder ${inputSourceName}. Output zip archive is ready for download.`,
                fileName: outputZipFileName,
                zipBuffer: zipBuffer, // Return zip buffer
            };
        }
    } catch (error: any) {
        console.error('Conversion process error:', error);
        return { success: false, error: `Conversion failed: ${error.message}` };
    } finally {
        // Clean up temporary directory
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
            console.log(`Cleaned up temporary directory: ${tempDir}`);
        } catch (cleanupError: any) {
            console.error(`Error cleaning up temporary directory ${tempDir}: ${cleanupError.message}`);
        }
    }
}


export async function convertCode(rawData: unknown): Promise<ConversionResult> {
    // Validate input data using the schema
    const validationResult = await FormSchema.safeParseAsync(rawData); // Use async validation
    if (!validationResult.success) {
       console.error("Server-side validation failed:", validationResult.error.errors);
      // Combine multiple validation errors into a single message
      const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.') || 'field'}: ${e.message}`).join('; ');
      return { success: false, error: `Invalid input: ${errorMessages}` };
    }

    const validatedData = validationResult.data;

    try {
      // Call the actual conversion logic
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
