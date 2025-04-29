
'use server';

import type { z } from 'zod';
import * as zod from 'zod'; // Use import * as z
import path from 'path'; // Import path for basename

// Define the expected input shape based on the form schema
// Re-define or import if the schema is in a shared location
const FormSchema = zod.object({
  mappingFile: zod.string().min(1),
  inputFileOrFolder: zod.string().min(1),
  isSingleFile: zod.boolean().default(false).optional(), // Added checkbox state
  outputFolder: zod.string().min(1), // Keep outputFolder for path saving, even if not used for direct writing here
});

// Make isSingleFile optional in the type used by the action, though the schema provides a default
// If the form passes it, it will be there.
type FormValues = Omit<zod.infer<typeof FormSchema>, 'isSingleFile'> & { isSingleFile?: boolean };


interface ConversionResult {
  success: boolean;
  message?: string; // Message for toast notifications
  error?: string;
  fileName?: string; // Suggested filename for download (.robot or .zip)
  fileContent?: string; // Actual content to be downloaded (single .robot content for now)
}

// Placeholder for the actual conversion logic
async function performConversion(data: FormValues): Promise<ConversionResult> {
  console.log("Starting conversion with data:", data);
  const isSingleFile = data.isSingleFile ?? false; // Default to false if undefined
  console.log("Input type:", isSingleFile ? "Single File" : "Folder");

  // --- Placeholder Logic ---
  // In a real application, this function would:
  // 1. Read the mapping file.
  // 2. Read the Playwright Python file(s).
  // 3. Parse the Python code.
  // 4. Apply mapping rules.
  // 5. Generate the .robot file content(s).
  // 6. If multiple files, create a zip archive containing them.
  // 7. Handle errors.

  // Simulate a successful conversion after a delay
  await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate work

  // Simulate potential errors based on input (for demonstration)
  if (data.inputFileOrFolder.includes('error')) {
     console.error("Simulated conversion error for:", data.inputFileOrFolder);
    return { success: false, error: 'Simulated error during conversion process.' };
  }

   if (!data.mappingFile.endsWith('.xlsx')) {
     console.error("Invalid mapping file extension:", data.mappingFile);
      return { success: false, error: 'Mapping file must be an .xlsx file.' };
   }

  // Simulate successful output content (still single file content for simplicity)
  const inputSourceName = path.basename(data.inputFileOrFolder).replace(/\.[^/.]+$/, ""); // Remove extension
  const mappingFileName = path.basename(data.mappingFile);
  const conversionType = isSingleFile ? 'file' : 'folder';

  // Determine output filename based on whether it's a single file or folder
  const outputFileName = isSingleFile
      ? `${inputSourceName}_converted.robot`
      : `${inputSourceName}_converted_robot_files.zip`; // Suggest .zip for folders

  // Generate success message based on output type
  const successMessage = isSingleFile
      ? `Successfully converted file ${inputSourceName}. Output file is ready for download.`
      : `Successfully converted folder ${inputSourceName}. Output zip archive is ready for download.`;


  // The content remains the same simulated single .robot file for now.
  // Real implementation would generate multiple files and zip them for folder input.
  const simulatedOutput = `*** Settings ***
Library    SeleniumLibrary
Documentation    Generated Robot test for ${conversionType} "${inputSourceName}"
...              using mapping "${mappingFileName}"
...              Output saved to: ${data.outputFolder} (Note: Path saved, file downloaded as ${outputFileName})

*** Variables ***
\${BROWSER}    chrome
\${URL}        https://example.com

*** Test Cases ***
Simulated Test Case from ${inputSourceName}
    Open Browser    \${URL}    \${BROWSER}
    Input Text      id=username    testuser
    Input Password  id=password    testpass
    Click Button    id=login-button
    Page Should Contain    Welcome, testuser!
    [Teardown]    Close Browser

*** Keywords ***
# Custom keywords based on Playwright functions would go here
# Example:
# Login With Credentials
#     [Arguments]    \${username}    \${password}
#     Input Text    id=username    \${username}
#     Input Password    id=password    \${password}
#     Click Button    id=login-button
`;


  console.log(`Conversion simulation successful. Preparing download for ${outputFileName}.`);
  return {
    success: true,
    message: successMessage,
    fileName: outputFileName, // Suggest .robot or .zip filename for download
    fileContent: simulatedOutput // Include single file content for download (actual zip logic needed for folders)
};
  // --- End Placeholder Logic ---
}


export async function convertCode(rawData: unknown): Promise<ConversionResult> {
    // Validate input data using the schema
    const validationResult = FormSchema.safeParse(rawData);
    if (!validationResult.success) {
       console.error("Server-side validation failed:", validationResult.error.errors);
      // Combine multiple validation errors into a single message
      const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return { success: false, error: `Invalid input: ${errorMessages}` };
    }

    const validatedData = validationResult.data;

    try {
      // Call the actual conversion logic
      const result = await performConversion(validatedData);
      return result;
    } catch (error) {
      console.error('Unexpected error in convertCode action:', error);
       let errorMessage = 'An unexpected server error occurred.';
        if (error instanceof Error) {
          errorMessage = error.message;
        }
      return { success: false, error: errorMessage };
    }
}
