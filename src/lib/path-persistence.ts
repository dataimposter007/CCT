
'use server'; // Mark this module for server-side execution only

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface Paths {
  mappingFile: string;
  inputFileOrFolder: string;
  isSingleFile?: boolean; // Keep optional for initial flexibility
  outputFolder: string;
}

// Use a file in the user's home directory for persistence
const filePath = path.join(os.homedir(), '.playwright_robot_converter_paths.json');


export async function savePaths(paths: Paths): Promise<void> {
  try {
    // Ensure isSingleFile is explicitly included, defaulting to false if undefined
    const dataToSave = {
        ...paths,
        isSingleFile: paths.isSingleFile ?? false,
    };
    const data = JSON.stringify(dataToSave, null, 2); // Pretty print JSON
    await fs.writeFile(filePath, data, 'utf-8');
    console.log('Paths saved successfully to:', filePath);
  } catch (error) {
    console.error('Error saving paths:', error);
    // Re-throw the error so the caller can handle it (e.g., show a toast)
    if (error instanceof Error) {
       throw new Error(`Failed to save paths: ${error.message}`);
    }
    throw new Error('An unknown error occurred while saving paths.');
  }
}

export async function loadPaths(): Promise<Paths | null> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const loadedData: Partial<Paths> = JSON.parse(data); // Parse as partial first
    console.log('Raw paths loaded from:', filePath, loadedData);

     // Validate required fields and types
     if (typeof loadedData.mappingFile !== 'string' ||
         typeof loadedData.inputFileOrFolder !== 'string' ||
         typeof loadedData.outputFolder !== 'string') {
         console.warn('Loaded paths data is missing required fields or has incorrect types. Ignoring.');
         return null; // Or throw an error if strict validation is needed
     }

     // Ensure isSingleFile is boolean, default to false if missing or wrong type
     const isSingleFile = typeof loadedData.isSingleFile === 'boolean' ? loadedData.isSingleFile : false;


    const paths: Paths = {
        mappingFile: loadedData.mappingFile,
        inputFileOrFolder: loadedData.inputFileOrFolder,
        outputFolder: loadedData.outputFolder,
        isSingleFile: isSingleFile, // Use validated/defaulted value
    };

    console.log('Validated paths loaded successfully:', paths);
    return paths;

  } catch (error) {
    // It's common for the file not to exist initially, handle this gracefully.
     if (error instanceof Error && error.code === 'ENOENT') {
      console.log('Default paths file not found, returning null.');
      return null; // File doesn't exist, return null
    }
     if (error instanceof SyntaxError) {
         console.error('Error parsing paths JSON:', error);
         // Optionally delete the corrupt file? fs.unlink(filePath);
         return null; // Invalid JSON, treat as no saved paths
     }
    // Log other errors but still return null or throw, depending on desired behavior
    console.error('Error loading paths:', error);
    if (error instanceof Error) {
       // Don't throw for generic load error, just return null
       // throw new Error(`Failed to load paths: ${error.message}`);
       return null;
    }
     // throw new Error('An unknown error occurred while loading paths.');
     return null; // Fallback to null for unknown errors
  }
}
