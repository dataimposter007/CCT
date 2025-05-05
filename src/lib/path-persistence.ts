// File path persistence is removed as browser security prevents accessing full file paths.
// File objects are handled directly in the frontend state and sent via FormData.

// If you need to persist *filenames* or *folder names* for display purposes,
// that logic would need to be implemented separately, potentially using
// localStorage on the client-side, but it cannot store actual file system paths
// that the server can directly access.


// 'use server'; // Keep if other server utilities remain, otherwise remove

// import fs from 'fs/promises';
// import path from 'path';
// import os from 'os';

// interface Paths {
//   mappingFile: string; // Would now likely store filename, not path
//   inputFileOrFolder: string; // Would now likely store filename or foldername, not path
//   isSingleFile?: boolean;
//   outputFolder: string; // Would store preferred folder name, not path
// }

// const filePath = path.join(os.homedir(), '.playwright_robot_converter_paths.json');


// export async function savePaths(paths: Paths): Promise<void> {
//   try {
//     const dataToSave = {
//         ...paths,
//         isSingleFile: paths.isSingleFile ?? false,
//     };
//     const data = JSON.stringify(dataToSave, null, 2);
//     await fs.writeFile(filePath, data, 'utf-8');
//     console.log('Path preferences (filenames) saved to:', filePath);
//   } catch (error) {
//     console.error('Error saving path preferences:', error);
//     if (error instanceof Error) {
//        throw new Error(`Failed to save path preferences: ${error.message}`);
//     }
//     throw new Error('An unknown error occurred while saving path preferences.');
//   }
// }

// export async function loadPaths(): Promise<Paths | null> {
//   try {
//     const data = await fs.readFile(filePath, 'utf-8');
//     const loadedData: Partial<Paths> = JSON.parse(data);
//     console.log('Raw path preferences loaded from:', filePath, loadedData);

//      if (typeof loadedData.mappingFile !== 'string' ||
//          typeof loadedData.inputFileOrFolder !== 'string' ||
//          typeof loadedData.outputFolder !== 'string') {
//          console.warn('Loaded path preferences data is missing required fields or has incorrect types. Ignoring.');
//          return null;
//      }

//      const isSingleFile = typeof loadedData.isSingleFile === 'boolean' ? loadedData.isSingleFile : false;


//     const paths: Paths = {
//         mappingFile: loadedData.mappingFile,
//         inputFileOrFolder: loadedData.inputFileOrFolder,
//         outputFolder: loadedData.outputFolder,
//         isSingleFile: isSingleFile,
//     };

//     console.log('Validated path preferences loaded successfully:', paths);
//     return paths;

//   } catch (error) {
//      if (error instanceof Error && error.code === 'ENOENT') {
//       console.log('Default path preferences file not found, returning null.');
//       return null;
//     }
//      if (error instanceof SyntaxError) {
//          console.error('Error parsing path preferences JSON:', error);
//          return null;
//      }
//     console.error('Error loading path preferences:', error);
//     return null;
//   }
// }
