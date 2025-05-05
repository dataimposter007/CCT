'use client';

import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as zod from 'zod';
import Image from 'next/image'; // Import next/image
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { FolderOpen, FileText, CodeXml, XCircle, Download, Info, Mail, Loader2, Sun, Moon, Upload, AlertTriangle } from 'lucide-react'; // Added Upload, AlertTriangle
import { useToast } from '@/hooks/use-toast';
// Removed import { savePaths, loadPaths } from '@/lib/path-persistence';
import { convertCode, getSheetNames } from './actions'; // Import server actions
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Link from 'next/link'; // Import Link for menu items
import { Progress } from "@/components/ui/progress"; // Import Progress component
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // Import Select components


// Define Zod schema for form validation
const FormSchema = zod.object({
  mappingFile: zod.instanceof(File, { message: "Please upload the Excel mapping file." }).refine(file => file.size > 0, "Mapping file cannot be empty."),
  inputFileOrFolder: zod.union([
    zod.instanceof(File, { message: "Please upload the Playwright Python file." }).refine(file => file.size > 0, "Input file cannot be empty."), // Single file
    zod.array(zod.instanceof(File)).min(1, "Please upload at least one Playwright Python file for folder mode.").refine(files => files.every(file => file.size > 0), "Input files cannot be empty.") // Folder (array of files)
  ]),
  isSingleFile: zod.boolean().default(false).optional(),
  selectedSheetName: zod.string().min(1, 'Please select a sheet from the mapping file.'), // Added for sheet selection
  // Removed outputFolder: z.string().min(1, 'Output folder path is required.'),
});

type FormValues = zod.infer<typeof FormSchema>;

// Helper function to trigger download
function triggerDownload(filename: string, data: string | Buffer) {
  const mimeType = filename.endsWith('.zip') ? 'application/zip' : 'text/plain;charset=utf-8';
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url); // Clean up the object URL
}


// Simple Menu Bar Component
const MenuBar = () => {
    const [isMounted, setIsMounted] = useState(false);
    const { theme, setTheme } = useTheme();

    useEffect(() => {
        setIsMounted(true);
    }, []);


    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };

     // Render null or a placeholder until mounted to avoid hydration mismatch
    const renderThemeToggle = () => {
        if (!isMounted) {
            // Render a placeholder or nothing during server render / initial client render
            return <div className="h-8 w-[76px]"></div>; // Placeholder matching switch size + icons
        }
        return (
            <div className="flex items-center space-x-2">
                <Sun className="h-5 w-5 text-muted-foreground" />
                <Switch
                    checked={theme === 'dark'}
                    onCheckedChange={toggleTheme}
                    aria-label="Toggle dark mode"
                    id="theme-switch-nav"
                />
                <Moon className="h-5 w-5 text-muted-foreground" />
            </div>
        );
    };


    return (
        // Removed max-w-4xl and mx-auto to make it full width within its container
        // Added items-baseline for better alignment with the larger NOKIA text
        <nav className="w-full flex justify-between items-baseline py-3 px-4 sm:px-6 mb-4 rounded-md bg-card/60 dark:bg-card/50 backdrop-blur-sm border border-border/30 shadow-sm">
            <div className="flex items-baseline space-x-4"> {/* Changed items-center to items-baseline */}
                 {/* NOKIA Brand Text */}
                 <span className="text-3xl font-extrabold text-primary dark:text-primary mr-6"> {/* Increased size, weight and margin, changed color */}
                    NOKIA
                 </span>
                 {/* End NOKIA Brand Text */}
                <Link href="#" passHref>
                    <Button variant="ghost" className="hover:bg-accent/80 hover:text-accent-foreground px-3 py-1.5 h-auto"> {/* Slightly darker hover */}
                        <Info className="mr-2 h-4 w-4" /> About
                    </Button>
                </Link>
                <Link href="#" passHref>
                     <Button variant="ghost" className="hover:bg-accent/80 hover:text-accent-foreground px-3 py-1.5 h-auto"> {/* Slightly darker hover */}
                        <Mail className="mr-2 h-4 w-4" /> Contact
                    </Button>
                </Link>
            </div>
            {renderThemeToggle()} {/* Render theme toggle conditionally */}
        </nav>
    );
};


export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingSheets, setIsFetchingSheets] = useState(false);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [progressValue, setProgressValue] = useState(0); // State for progress bar
  const [isMounted, setIsMounted] = useState(false); // State to track client mount
  const { toast } = useToast();
  const { theme } = useTheme(); // Get current theme

  // File input refs
  const mappingFileInputRef = useRef<HTMLInputElement>(null);
  const inputFilesInputRef = useRef<HTMLInputElement>(null);
  const darkLogoPlaceholder = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // 1x1 transparent pixel


  // State for the dynamically determined image source
  // Initialize with the light mode logo path, ensuring it starts with '/'
  const lightLogo = '/logolight.png';
  const [imageSrc, setImageSrc] = useState(lightLogo); // Start with light logo


  // Effect to set isMounted to true after component mounts on client
  useEffect(() => {
    setIsMounted(true);
  }, []);

   // Effect to update image source based on theme, only runs after mounting
    useEffect(() => {
        if (isMounted) {
            // Determine the correct logo based on the theme
            const resolvedTheme = theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme;
            const currentSrc = resolvedTheme === 'dark' ? darkLogoPlaceholder : lightLogo; // Use placeholder for dark
            setImageSrc(currentSrc);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme, isMounted]); // Depend on theme and isMounted


  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      // Initialize file fields as null or undefined, Zod handles the validation
      mappingFile: undefined,
      inputFileOrFolder: undefined,
      isSingleFile: false, // Default value for checkbox
      selectedSheetName: '', // Default for sheet selection
    },
    mode: 'onChange', // Validate on change to enable/disable sheet select
  });

  const isSingleFile = form.watch('isSingleFile');
  const mappingFile = form.watch('mappingFile');

  // --- Fetch Sheet Names ---
  useEffect(() => {
    // Reset sheets when mapping file changes or is cleared
    setSheetNames([]);
    setSheetError(null);
    form.setValue('selectedSheetName', ''); // Reset sheet selection

    if (mappingFile instanceof File && mappingFile.size > 0) {
      setIsFetchingSheets(true);
      const formData = new FormData();
      formData.append('mappingFile', mappingFile);

      getSheetNames(formData)
        .then(result => {
          if (result.success && result.sheetNames) {
            setSheetNames(result.sheetNames);
            setSheetError(null);
            // Auto-select first sheet if available
            if (result.sheetNames.length > 0) {
              form.setValue('selectedSheetName', result.sheetNames[0], { shouldValidate: true });
            }
          } else {
            setSheetNames([]);
            setSheetError(result.error || 'Failed to fetch sheet names.');
            toast({
              title: 'Error Reading Sheets',
              description: result.error || 'Could not read sheets from the Excel file.',
              variant: 'destructive',
            });
          }
        })
        .catch(error => {
          console.error("Error in getSheetNames action:", error);
          setSheetNames([]);
          setSheetError('An error occurred while fetching sheet names.');
          toast({
            title: 'Error Fetching Sheets',
            description: 'An unexpected error occurred.',
            variant: 'destructive',
          });
        })
        .finally(() => {
          setIsFetchingSheets(false);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Trigger only when mappingFile changes
  }, [mappingFile]);


  // Effect to simulate progress increase during loading
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isLoading) {
      setProgressValue(10); // Start progress immediately
      timer = setInterval(() => {
        setProgressValue((prev) => {
          if (prev >= 95) { // Simulate stalling near the end
             if (timer) clearInterval(timer);
             return 95;
          }
          return prev + 5; // Increment progress
        });
      }, 150); // Adjust interval for desired speed (matches simulated delay)
    } else {
      // If loading finishes quickly or is cancelled, ensure progress reaches 100
       if (progressValue > 0 && progressValue < 100) {
           setProgressValue(100);
       } else if (progressValue === 100) {
          // Optional: Hide progress bar after a short delay
         // setTimeout(() => setProgressValue(0), 500);
       }
       // else progress is 0, do nothing
    }

    return () => { // Cleanup interval on unmount or when isLoading changes
      if (timer) clearInterval(timer);
    };
  }, [isLoading, progressValue]); // Added progressValue dependency to handle setting to 100% correctly


  // Removed useEffect for loading/saving paths

  // --- File Handling ---
  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    fieldName: 'mappingFile' | 'inputFileOrFolder'
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      form.setValue(fieldName, undefined, { shouldValidate: true }); // Clear value if no file selected
      return;
    }

    if (fieldName === 'mappingFile') {
       if (!files[0].name.endsWith('.xlsx')) {
            toast({
                title: "Invalid File Type",
                description: "Mapping file must be an .xlsx file.",
                variant: "destructive",
            });
            form.setValue(fieldName, undefined, { shouldValidate: true }); // Clear value
            // Reset the input field value so the user can select the same file again if needed after fixing
             if (mappingFileInputRef.current) {
                 mappingFileInputRef.current.value = '';
             }
            return;
        }
      form.setValue(fieldName, files[0], { shouldValidate: true });
    } else if (fieldName === 'inputFileOrFolder') {
      if (isSingleFile) {
        if (!files[0].name.endsWith('.py')) {
             toast({
                title: "Invalid File Type",
                description: "Input file must be a Python (.py) file.",
                variant: "destructive",
              });
              form.setValue(fieldName, undefined, { shouldValidate: true });
              // Reset input ref value
             if (inputFilesInputRef.current) {
                 inputFilesInputRef.current.value = '';
             }
             return;
         }
        form.setValue(fieldName, files[0], { shouldValidate: true });
      } else {
        // Folder mode - filter only .py files
         const pyFiles = Array.from(files).filter(file => file.name.endsWith('.py'));
         if (pyFiles.length === 0) {
              toast({
                title: "No Python Files Found",
                description: "The selected folder contains no Python (.py) files.",
                variant: "warning", // Use warning variant
              });
              form.setValue(fieldName, undefined, { shouldValidate: true });
         } else {
            form.setValue(fieldName, pyFiles, { shouldValidate: true });
            if (pyFiles.length < files.length) {
                 toast({
                    title: "Non-Python Files Skipped",
                    description: `${files.length - pyFiles.length} non-Python files were ignored.`,
                    variant: "default",
                 });
            }
         }
         // Reset input ref value after processing
          if (inputFilesInputRef.current) {
              inputFilesInputRef.current.value = '';
          }
      }
    }
  };


  const handleClearFile = (fieldName: 'mappingFile' | 'inputFileOrFolder') => {
    form.setValue(fieldName, undefined, { shouldValidate: true });
     // Clear the corresponding file input ref
     if (fieldName === 'mappingFile' && mappingFileInputRef.current) {
       mappingFileInputRef.current.value = '';
       setSheetNames([]); // Also clear sheets
       setSheetError(null);
     } else if (fieldName === 'inputFileOrFolder' && inputFilesInputRef.current) {
       inputFilesInputRef.current.value = '';
     }
    toast({
        title: "File Cleared",
        description: `Selected file for ${fieldName === 'mappingFile' ? 'Mapping File' : 'Input'} cleared.`,
        variant: "default",
      });
  };


  const onSubmit: SubmitHandler<FormValues> = async (data) => {
     setIsLoading(true);
     setProgressValue(0); // Reset progress on new submission
     console.log("Form submitted, preparing FormData...");

     // --- Create FormData ---
     const formData = new FormData();
     formData.append('isSingleFile', String(data.isSingleFile));

      // Append mapping file
     if (data.mappingFile instanceof File) {
         formData.append('mappingFile', data.mappingFile);
     } else {
         console.error("Mapping file is not a File object:", data.mappingFile);
         toast({ title: 'Error', description: 'Mapping file is missing or invalid.', variant: 'destructive' });
         setIsLoading(false);
         return;
     }

      // Append selected sheet name
     if (data.selectedSheetName) {
         formData.append('selectedSheetName', data.selectedSheetName);
     } else {
          console.error("Selected sheet name is missing");
          toast({ title: 'Error', description: 'Please select a sheet from the mapping file.', variant: 'destructive' });
          setIsLoading(false);
          return;
     }

      // Append input file(s)
     if (data.isSingleFile && data.inputFileOrFolder instanceof File) {
         formData.append('inputFileOrFolder', data.inputFileOrFolder);
     } else if (!data.isSingleFile && Array.isArray(data.inputFileOrFolder)) {
         data.inputFileOrFolder.forEach(file => {
             if (file instanceof File) {
                 formData.append('inputFileOrFolder', file); // Append each file for folder mode
             } else {
                 console.warn("Found non-File object in inputFileOrFolder array:", file);
             }
         });
          if (formData.getAll('inputFileOrFolder').length === 0) {
              console.error("Input folder contains no valid File objects.");
              toast({ title: 'Error', description: 'No valid input files found for folder mode.', variant: 'destructive' });
              setIsLoading(false);
              return;
          }
     } else {
          console.error("Input file(s) are missing or invalid:", data.inputFileOrFolder);
          toast({ title: 'Error', description: 'Input file(s) are missing or invalid.', variant: 'destructive' });
          setIsLoading(false);
          return;
     }

      // Removed saving paths

     try {
       console.log("Calling convertCode server action...");
       const result = await convertCode(formData); // Pass FormData directly
       console.log("Server action result:", result);

       // Ensure progress reaches 100% even if conversion is instant
       await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
       setProgressValue(100);

       if (result.success && result.fileName) {
         toast({
           title: 'Conversion Successful',
           description: `${result.message || 'Starting download...'}`,
         });
         // Trigger download based on result type
         if (result.fileContent) {
           triggerDownload(result.fileName, result.fileContent);
         } else if (result.zipBuffer) {
             // Convert ArrayBuffer back to Buffer if needed, or handle ArrayBuffer directly
             // Assuming zipBuffer is ArrayBuffer like from fetch
             const buffer = Buffer.from(result.zipBuffer); // Convert ArrayBuffer to Node Buffer
             triggerDownload(result.fileName, buffer);
         } else {
              console.error("Conversion successful but no downloadable content provided.");
              toast({ title: 'Download Error', description: 'No file content received.', variant: 'destructive' });
         }

       } else {
         console.error("Conversion failed:", result.error);
         toast({
           title: 'Conversion Failed',
           description: result.error || 'An unknown error occurred during conversion.',
           variant: 'destructive',
         });
       }
     } catch (error) {
         console.error('Error during convertCode action call or download:', error);
         await new Promise(resolve => setTimeout(resolve, 50));
         setProgressValue(100);
         let errorMessage = 'An unexpected error occurred during the conversion process.';
         if (error instanceof Error) {
             errorMessage = error.message;
         }
         toast({
             title: 'Process Error',
             description: errorMessage,
             variant: 'destructive',
         });
     } finally {
       setIsLoading(false);
        // Optional: Reset progress bar after a short delay
        setTimeout(() => {
            if (progressValue === 100) {
                setProgressValue(0); // Reset to 0 after completion
            }
        }, 1000);
     }
   };


    // Function to handle image loading errors
    const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        const target = e.target as HTMLImageElement;
        if (target.src.includes('logolight.png')) {
            // If the light logo fails, maybe try a placeholder or log specific error
            console.error(`Primary logo failed to load: ${target.src}`);
            setImageSrc(darkLogoPlaceholder); // Fallback to placeholder
        } else {
            console.error(`Image failed to load: ${target.src}`);
        }
    };


  return (
    // Use padding and flex to arrange elements
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 relative">

        {/* Menu Bar - Now spans full width */}
        <MenuBar />


       {/* Logo - Positioned above the card */}
       <div className="flex flex-col items-center mb-6 text-center relative">
           {/* Single Logo Placeholder - Centered and Enlarged */}
           <div className="flex justify-center items-center mb-4 h-[240px] w-[240px]"> {/* Fixed size container */}
               {/* Render Image only after mount to avoid hydration error */}
                {isMounted ? (
                    <Image
                        key={imageSrc} // Key helps React diff changes
                        src={imageSrc}
                        alt="Code Converter Logo"
                        width={240} // Keep desired size
                        height={240} // Keep desired size
                        className="rounded-lg object-contain bg-transparent transition-opacity duration-300 ease-in-out" // Smooth transition
                        style={{ opacity: imageSrc === darkLogoPlaceholder && theme !== 'dark' ? 0 : 1 }} // Hide placeholder if not dark theme
                        priority // Prioritize loading the logo
                        data-ai-hint="abstract logo"
                        onError={handleImageError} // Add error handler
                    />
                 ) : (
                    // Placeholder div with the same dimensions during SSR/initial mount
                    <div role="status" aria-label="Loading logo..." className="h-[240px] w-[240px] bg-muted/20 rounded-lg shadow-lg animate-pulse"></div>
                )}
           </div>
        </div>


      {/* Card for the form */}
      <Card className="w-full max-w-2xl shadow-xl backdrop-blur-[28px] bg-card/5 dark:bg-card/[0.03] border border-border/10 rounded-2xl overflow-hidden">
        <CardContent className="pt-6 px-6 sm:px-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                {/* Mapping File Input */}
                <FormField
                  control={form.control}
                  name="mappingFile"
                  render={({ field: { onChange, onBlur, name, ref, value }, fieldState }) => ( // Destructure field for access
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <FileText className="h-5 w-5 text-primary" />
                        Excel Mapping File (.xlsx)
                      </FormLabel>
                      <FormControl>
                        <div className="flex flex-col sm:flex-row gap-2 items-start">
                          {/* Hidden actual file input */}
                          <Input
                            type="file"
                            accept=".xlsx"
                            ref={mappingFileInputRef} // Use ref for the hidden input
                            onChange={(e) => handleFileChange(e, 'mappingFile')}
                            className="hidden"
                            id="mappingFileInput" // Add id for label association
                          />
                           {/* Display area */}
                          <div className="flex-grow flex items-center justify-between p-2 min-h-[40px] rounded-md border border-input bg-background/10 dark:bg-background/[0.05] border-border/20 text-sm">
                             <span className={`truncate ${value ? 'text-foreground' : 'text-muted-foreground'}`}>
                               {value instanceof File ? value.name : "No file selected"}
                             </span>
                             {value && (
                               <Button type="button" variant="ghost" size="icon" onClick={() => handleClearFile('mappingFile')} className="shrink-0 text-muted-foreground hover:text-destructive h-6 w-6 ml-2" aria-label="Clear mapping file">
                                  <XCircle className="h-4 w-4" />
                               </Button>
                             )}
                           </div>
                           {/* Custom Upload Button */}
                           <Button
                                type="button"
                                variant="outline"
                                onClick={() => mappingFileInputRef.current?.click()} // Trigger hidden input
                                className="shrink-0 bg-white/50 dark:bg-transparent"
                           >
                            <Upload className="mr-2 h-4 w-4" /> Upload File
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                 {/* Sheet Selection Dropdown */}
                <FormField
                  control={form.control}
                  name="selectedSheetName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <FileText className="h-5 w-5 text-primary" />
                        Select Mapping Sheet
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={isFetchingSheets || sheetNames.length === 0 || !!sheetError || !mappingFile} // Disable logic
                      >
                        <FormControl>
                          <SelectTrigger className="bg-background/10 dark:bg-background/[0.05] border-border/20">
                            <SelectValue placeholder={
                              isFetchingSheets ? "Loading sheets..." :
                              !mappingFile ? "Upload mapping file first" :
                              sheetError ? "Error loading sheets" :
                              sheetNames.length === 0 ? "No sheets found" :
                              "Select a sheet"
                            } />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sheetError && (
                            <SelectItem value="error" disabled className="text-destructive-foreground">
                              <AlertTriangle className="inline-block mr-2 h-4 w-4" /> {sheetError}
                            </SelectItem>
                          )}
                          {!isFetchingSheets && !sheetError && sheetNames.length === 0 && mappingFile && (
                             <SelectItem value="no-sheets" disabled>No sheets found in file</SelectItem>
                          )}
                          {sheetNames.map((sheet) => (
                            <SelectItem key={sheet} value={sheet}>
                              {sheet}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />


                 {/* Single File Checkbox */}
                 <FormField
                    control={form.control}
                    name="isSingleFile"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border border-border/20 p-3 shadow-sm bg-muted/[0.05] dark:bg-muted/[0.03]">
                            <FormControl>
                                <Checkbox
                                checked={field.value}
                                onCheckedChange={(checked) => {
                                      field.onChange(checked);
                                      // Clear the input file/folder field when switching modes
                                      form.setValue('inputFileOrFolder', undefined, { shouldValidate: true });
                                      if (inputFilesInputRef.current) {
                                          inputFilesInputRef.current.value = '';
                                      }
                                  }}
                                id="isSingleFile"
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel htmlFor="isSingleFile" className="font-normal text-foreground/80 dark:text-foreground/70 cursor-pointer">
                                Convert a single Python file (otherwise, select a folder).
                                </FormLabel>
                            </div>
                        </FormItem>
                    )}
                    />

                {/* Input File/Folder Input */}
                <FormField
                  control={form.control}
                  name="inputFileOrFolder"
                  render={({ field: { value }, fieldState }) => ( // Only need value here
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <CodeXml className="h-5 w-5 text-primary" />
                        {isSingleFile ? 'Playwright Python File (.py)' : 'Playwright Python Folder'}
                      </FormLabel>
                       <FormControl>
                          <div className="flex flex-col sm:flex-row gap-2 items-start">
                             {/* Hidden file input */}
                             <Input
                                type="file"
                                accept={isSingleFile ? ".py" : undefined} // Accept only .py for single file
                                multiple={!isSingleFile} // Allow multiple for folder
                                webkitdirectory={!isSingleFile ? "true" : undefined} // Enable folder selection
                                mozdirectory={!isSingleFile ? "true" : undefined} // Firefox support
                                odirectory={!isSingleFile ? "true" : undefined} // Older Opera support
                                directory={!isSingleFile ? "true" : undefined} // Standard attribute
                                ref={inputFilesInputRef}
                                onChange={(e) => handleFileChange(e, 'inputFileOrFolder')}
                                className="hidden"
                                id="inputFilesInput"
                             />
                              {/* Display area */}
                              <div className="flex-grow flex items-center justify-between p-2 min-h-[40px] rounded-md border border-input bg-background/10 dark:bg-background/[0.05] border-border/20 text-sm">
                                 <span className={`truncate ${value ? 'text-foreground' : 'text-muted-foreground'}`}>
                                   {value instanceof File
                                     ? value.name // Single file mode
                                     : Array.isArray(value) && value.length > 0
                                     ? `${value.length} Python file(s) selected` // Folder mode
                                     : isSingleFile ? "No file selected" : "No folder selected"}
                                 </span>
                                 {value && (
                                   <Button type="button" variant="ghost" size="icon" onClick={() => handleClearFile('inputFileOrFolder')} className="shrink-0 text-muted-foreground hover:text-destructive h-6 w-6 ml-2" aria-label="Clear input file/folder">
                                      <XCircle className="h-4 w-4" />
                                   </Button>
                                 )}
                               </div>
                              {/* Custom Upload Button */}
                             <Button
                                type="button"
                                variant="outline"
                                onClick={() => inputFilesInputRef.current?.click()}
                                className="shrink-0 bg-white/50 dark:bg-transparent"
                            >
                                {isSingleFile ? <Upload className="mr-2 h-4 w-4" /> : <FolderOpen className="mr-2 h-4 w-4" />}
                                {isSingleFile ? "Upload File" : "Select Folder"}
                            </Button>
                          </div>
                       </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Removed Output Folder Input */}


                {/* Progress Bar and Buttons Row */}
                <div className="flex flex-col gap-4 pt-6 border-t mt-6 border-border/20"> {/* Adjusted border alpha */}
                     {/* Progress Bar */}
                     <div className={`transition-opacity duration-300 ${isLoading || progressValue > 0 ? 'opacity-100 h-auto' : 'opacity-0 h-0'}`}>
                        <div className="flex items-center space-x-2">
                            <Progress value={progressValue} className="w-full h-2 transition-all duration-150 ease-linear" />
                             <span className="text-xs font-mono text-muted-foreground min-w-[40px] text-right">{`${Math.round(progressValue)}%`}</span>
                        </div>
                     </div>

                     {/* Convert Button */}
                    <Button type="submit" disabled={isLoading || isFetchingSheets} className="w-full text-base py-3 transition-all duration-300 ease-in-out transform hover:scale-105">
                        {isLoading || isFetchingSheets ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            {isFetchingSheets ? 'Reading sheets...' : 'Converting...'}
                        </>
                        ) : (
                        <>
                            <Download className="mr-2 h-5 w-5" /> Convert & Download
                        </>
                        )}
                    </Button>
                </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
