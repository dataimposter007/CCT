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
    // Let's remove the parenthesis for the fallback case based on Python's extract_locator interaction
    return method_name_with_parens.replace(/\(\)$/, ''); // Return method name without ()
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
    // Python: if "#" in locator_text: return r"\#" + locator_text.split("#")[-1].split('"')[0]
    let idMatch = locator_text.match(/#([^"'\s]+)/);
    if (idMatch) {
        return `\\#${idMatch[1]}`; // Prefix with backslash for RF ID locator
    }

    // Handle name attributes: ... name="Submit" ... -> "Submit" (matches Python logic)
    // Python: elif "name=" in locator_text: match = re.search(r'name=\"([^\"]*)\"', locator_text) ...
    let nameMatch = locator_text.match(/name\s*=\s*["']([^"']+)["']/);
    if (nameMatch) {
        return `"${nameMatch[1]}"`; // Return just the name value in quotes
    }

     // Handle simple quoted strings within parentheses: ("some value") -> "some value" (matches Python logic)
     // Python: elif re.search(r'\("([^\"]*)"\)', locator_text): match = re.search(r'\("([^\"]*)"\)', locator_text) ...
     let parenMatch = locator_text.match(/^\(*["']([^"']+)["']\)*$/); // More robust regex to catch ('value') or ("value")
     if (parenMatch) {
          return `"${parenMatch[1]}"`; // Return the content within quotes
     }

    // Handle strings that might be direct locators without parens, e.g. "text=Login"
    // Python: else: return f'"{locator_text}"' (Default case)
    if (locator_text.startsWith('"') && locator_text.endsWith('"')) {
        return locator_text;
    } else if (locator_text.startsWith("'") && locator_text.endsWith("'")) {
         // Convert single quotes to double quotes for consistency
        return `"${locator_text.slice(1, -1)}"`;
    } else if(locator_text) {
         // If it's not empty and not quoted, quote it
         return `"${locator_text}"`;
    }

    // Fallback: return empty string if nothing matched and input was empty/null
    return "";
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
    let insideTestCaseSection = false; // Tracks if we are *in* the *** Test Cases *** section
    let isTestCaseLine = false; // Tracks if the current line *is* a test case name (starts non-space)
    const testCaseIndent = '    '; // 4 spaces

    for (const line of lines) {
        const strippedLine = line.trim();

        // Handle section headers
        if (stripped_line.startsWith('***')) {
            formattedLines.push(line); // Preserve section headers exactly
            insideTestCaseSection = stripped_line.toUpperCase().includes('TEST CASES');
            isTestCaseLine = false; // Reset when leaving/entering sections
            continue;
        }

        // Preserve blank lines and comments
        if (!strippedLine || stripped_line.startsWith('#')) {
            formattedLines.push(line);
            continue;
        }

        // Handle lines within *** Test Cases *** section
        if (insideTestCaseSection) {
            // Check if it's a test case name (starts with non-space)
            if (line.match(/^\S/)) {
                formattedLines.push(line); // Keep test case name as is (no indent)
                isTestCaseLine = true; // Mark that we are now inside a test case definition
            }
            // Check if it's a step within the current test case
            else if (isTestCaseLine && strippedLine) {
                // It's a step, indent it
                formattedLines.push(testCaseIndent + strippedLine);
            }
            // Handle unexpected lines (e.g., comments, blank lines were handled above)
            else {
                 formattedLines.push(line); // Preserve other lines within the section? Or potentially indent? Current python logic preserves.
                 // Let's stick to preserving based on the Python example's output.
            }
        }
        // Handle lines outside *** Test Cases *** (like Settings, Variables, Keywords)
        else {
             formattedLines.push(line); // Preserve these lines as they are
             isTestCaseLine = false; // Not in a test case definition
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

    const rawLines = inputCode.split("\n");
    let lines: string[] = [];

    // Pre-processing for page.once (from Python logic)
    // Python code specific:
    // if line.strip().startswith("page.once"):
    // lines.append('${promise} =       Promise To    Wait For Alert    action=accept   text=<text content of alert box if you want to assert>')
    // lines.append('<Line which triggers the alert action> ex click  <button>')
    // else: lines.append(line)
    rawLines.forEach(line => {
        const stripped = line.trim();
        // Handle page.once specifically for dialog dismissal (as per Python example)
        if (stripped.startsWith("page.once") && stripped.includes('lambda dialog: dialog.dismiss())')) {
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
        // Python: if stripped_line == "context.close()": context_close_found = True; break
        if (stripped_line === "context.close()") {
            contextCloseFound = true;
            break; // Exit processing as per Python logic
        }

        // Handle expect() - Following Python structure
        // Python: if stripped_line.startswith("expect("): ...
        if (stripped_line.startsWith("expect(")) {
            // Python: variable_name = f"${{var{variable_counter}}}"; variable_counter += 1
            const variable_name = `\${var${variable_counter}}`;
            variable_counter++;

            // Python: locator_match = re.search(r'locator\("([^"]+)"\)', stripped_line)
            const locatorMatch = stripped_line.match(/locator\("([^"]+)"\)/);
            if (locatorMatch) {
                 let locator_text = locatorMatch[1];
                  // Python: if "#" in locator_text: locator_text = r"\#" + locator_text.split("#")[-1]
                 if (locator_text.includes("#")) {
                     locator_text = `\\#${locator_text.split("#").pop()}`;
                 }
                 // Python appends these two lines, NOTE the indentation difference between them
                 testCaseLines.push(`${variable_name}    Set Variable    ${locator_text}`); // Indentation handled by alignRobotCode
                 testCaseLines.push(`Wait For Elements State    ${variable_name}    visible    timeout=10s`); // Indentation handled by alignRobotCode

                // Python: expected_text_match = re.search(r'to_contain_text\("([^"]+)"\)', stripped_line)
                const expectedTextMatch = stripped_line.match(/to_contain_text\("([^"]+)"\)/);
                if (expectedTextMatch) {
                    const expected_text = expectedTextMatch[1];
                     // Python appends this line, NOTE indentation
                     testCaseLines.push(`Get Text    ${variable_name}    ==    ${expected_text}`); // Use '==' for assertion as per Python example output
                }
            }
            continue; // Move to next line
        }

        // Handle page.goto() - Following Python structure
        // Python: if re.match(r'page\d*\.goto\("[^"]+"\)', stripped_line): ...
        const gotoMatch = stripped_line.match(/page\d*\.goto\(['"]([^'"]+)['"]\)/);
         if (gotoMatch) {
             writingStarted = true; // Start processing lines
             const url = gotoMatch[1];

             if (firstGoto) {
                 // Python adds "Test Case" name (literal) and Browser/Context/Page setup
                 testCaseLines.push("Test Case"); // Literal name from Python, indentation handled by alignRobotCode
                 // Python: "New Browser ${BROWSER} headless=False timeout=60000 slowMo=0:00:01"
                 // RF Browser lib doesn't directly support slowMo, use standard keywords. Adjusting based on Python output.
                 testCaseLines.push(`New Browser        ${variableLines.includes('${BROWSER}') ? '${BROWSER}' : 'firefox'}        headless=False`); // Indentation handled by alignRobotCode
                 // Python: "New Context viewport={'width': 1920, 'height': 1080}"
                 testCaseLines.push(`New Context        viewport={'width': 1920, 'height': 1080}`); // Indentation handled by alignRobotCode
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
                  // Python: "New Page ${URL<counter>}"
                 testCaseLines.push(`New Page            ${var_name}`); // Indentation handled by alignRobotCode
                 firstGoto = false;
             } else {
                 // Subsequent navigations use "Go To"
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
                 testCaseLines.push(`Go To    ${var_name}`); // Indentation handled by alignRobotCode
             }
             continue; // Move to next line
         }

        // Skip lines before the first goto or implicit start
        // Python: if not writing_started: continue
        if (!writingStarted) {
            continue;
        }

        // Handle browser.close() - Following Python structure
        // Python: if stripped_line.startswith("browser.close"): ...
        if (stripped_line.startsWith("browser.close")) {
             // Python adds "Close Browser" indented
             testCaseLines.push("Close Browser"); // Indentation handled by alignRobotCode
             writingStarted = false; // Stop processing after browser close
             continue;
        }

        // General command processing - Following Python structure
        // Python: parts = safe_split_outside_quotes(stripped_line); parts = [part.strip() for part in parts if part.strip()]
        const parts = safeSplitOutsideQuotes(stripped_line, '.');
        const commandParts = parts.map(part => part.trim()).filter(part => part);

        if (commandParts.length < 1) { // Python: if not parts: continue
            continue;
        }

         // Python logic: method is last part, locator_chain is parts[1:-1]
         const methodPart = commandParts[commandParts.length - 1]; // Python: method = parts[-1]
         const locatorChainParts = commandParts.slice(1, -1); // Python: locator_chain = parts[1:-1] (Excludes page/context, includes locator parts)


         // Python regex: method_match = re.match(r'([a-zA-Z_]+)\((.*)\)', method)
        const methodMatch = methodPart.match(/^([a-zA-Z_]+)\((.*)\)$/);
        if (methodMatch) {
            const method_name_only = methodMatch[1];
            const method_name_signature = `${method_name_only}()`; // Python: method_name = method_match.group(1) + "()"
            let method_args_raw = methodMatch[2]?.trim() ?? ''; // Python: method_args = method_match.group(2)

            // Python: transformed_method = find_nearest_match(method_name, mapping)
            const transformed_method = findNearestMatch(method_name_signature, mapping);

            // Locator extraction based on Python logic
            // Python: locator_text = "<" + "><".join(locator_chain) + ">" if locator_chain else ""
            // Python: if locator_text: locator_text = re.search(r'<(.*)>', locator_text).group(1); locator_text = extract_locator(locator_text)
            let locator_text = "";
            if (locatorChainParts.length > 0) {
                // The python code joins with '><' which seems odd, it might intend to just use the last part or a specific structure.
                // Let's assume the relevant locator part is the primary element in the chain for extraction.
                // Example: page.locator("...").first.click() -> locatorChain = ['locator("...")', 'first']
                // Python's `extract_locator` seems to expect the raw locator string part.
                const primaryLocatorPart = locatorChainParts[0]; // Often the first part holds the main selector
                locator_text = extractLocator(primaryLocatorPart);
            } else if (method_args_raw && !transformed_method.toLowerCase().includes('select') && !transformed_method.toLowerCase().includes('fill')) {
                 // If no locator chain, and it's not a method that typically takes values as first arg (like fill/select),
                 // treat the first arg as a potential locator. Python logic is implicit here.
                 locator_text = extractLocator(method_args_raw);
                 if (locator_text !== `"${method_args_raw}"`) { // If extraction did something meaningful
                     method_args_raw = ""; // Args were consumed as locator
                 } else {
                     locator_text = ""; // Extraction didn't find a standard locator, reset
                 }
            }


             // Argument Handling based on Python logic
             let reformatted_line = "";
             // Python: if method_name == "select_option()": ...
             if (method_name_signature === "select_option()") {
                 const args = method_args_raw.trim();
                 // Python logic distinguishes list vs single value - JS needs parsing
                 let processedArgs = args;
                  try {
                      // Attempt to parse as JSON array (handles ["Option 1", "Option 2"])
                      const parsedArgs = JSON.parse(args.replace(/'/g, '"')); // Replace single quotes for JSON compatibility
                      if (Array.isArray(parsedArgs)) {
                          // Format for RF list: separate items with '    '
                          processedArgs = parsedArgs.join('    ');
                      }
                  } catch {
                      // If not a JSON array, treat as a single value (or comma-separated string potentially)
                      processedArgs = args.replace(/^["']|["']$/g, ''); // Remove outer quotes
                  }

                 if (args.startsWith("[")) {
                      // Python: reformatted = f" {transformed_method}    {locator_text}    {args}"
                      // Note: Python's example output shows list items separated by spaces/tabs for RF
                      reformatted_line = `${transformed_method}    ${locator_text}    ${processedArgs}`;
                 } else {
                      // Python: reformatted = f" Select options by    {locator_text}      Value      {args}"
                      // Using "Select options by Value" specifically as per python code/example
                      reformatted_line = `Select Options By    ${locator_text}    Value    ${processedArgs}`;
                 }
             } else if (method_args_raw) {
                 // Python: cleaned_args = re.sub(r'^"(.*)"$', r'\1', method_args)
                 const cleaned_args = method_args_raw.replace(/^["'](.*)["']$/, '$1');
                  // Python: reformatted = f" {transformed_method}    {locator_text}    {cleaned_args}".strip()
                 reformatted_line = `${transformed_method}    ${locator_text}    ${cleaned_args}`.trim();
             } else {
                 // Python: reformatted = f" {transformed_method}    {locator_text}".strip()
                 reformatted_line = `${transformed_method}    ${locator_text}`.trim();
             }
             // Add the formatted line without leading/trailing spaces, indentation handled by alignRobotCode
             testCaseLines.push(reformatted_line.trim());

        } else {
             // Fallback for lines not matching the method pattern
             // Python: test_case_lines.append(" " + " ".join(parts)) -> Adds single space indent + joins with space
             // Let's just join the parts; alignRobotCode should handle indentation if needed.
             testCaseLines.push(commandParts.join('    ')); // Join with RF separator
        }
    }

     // Add teardown based on Python logic
     // Python: if context_close_found: test_case_lines.append(" Close Context"); test_case_lines.append(" Close Browser")
     if (contextCloseFound) {
        testCaseLines.push("Close Context"); // Indentation handled by alignRobotCode
        testCaseLines.push("Close Browser"); // Indentation handled by alignRobotCode
     } else if (writingStarted && !firstGoto) { // Add default teardown if needed and conversion started
        const lastStep = testCaseLines[testCaseLines.length - 1]?.trim();
         if (lastStep && !lastStep.startsWith('Close Context') && !lastStep.startsWith('Close Browser')) {
            testCaseLines.push("Close Context"); // Indentation handled by alignRobotCode
            testCaseLines.push("Close Browser"); // Indentation handled by alignRobotCode
        }
     }


    // Combine all sections based on Python structure
    // Python: final_output = "\n".join(output_lines + variable_lines + test_case_lines)
    const final_output = [
        ...outputLines, '', // Blank line separator
        ...variableLines, '', // Blank line separator
        ...testCaseLines
    ].join('\n');

    // Apply alignment as the last step, similar to Python calling align_robot_test_cases on the output file
    // Python: align_robot_test_cases(output_path, output_path)
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
