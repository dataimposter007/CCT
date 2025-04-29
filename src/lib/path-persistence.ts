
'use server'; // Mark this module for server-side execution only

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface Paths {
  mappingFile: string;
  inputFileOrFolder: string;
  isSingleFile?: boolean; // Make optional here as well for flexibility
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
    const paths: Paths = JSON.parse(data);
    console.log('Paths loaded successfully from:', filePath);
    // Ensure isSingleFile exists in the loaded object, default if not
    return { ...paths, isSingleFile: paths.isSingleFile ?? false };
  } catch (error) {
    // It's common for the file not to exist initially, handle this gracefully.
     if (error instanceof Error && error.code === 'ENOENT') {
      console.log('Default paths file not found, returning null.');
      return null; // File doesn't exist, return null
    }
    // Log other errors but still return null or throw, depending on desired behavior
    console.error('Error loading paths:', error);
    if (error instanceof Error) {
       throw new Error(`Failed to load paths: ${error.message}`); // Re-throw other errors
    }
     throw new Error('An unknown error occurred while loading paths.');
  }
}

      