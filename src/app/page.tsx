'use client';

import type React from 'react';
import { useState, useEffect, useRef, type SubmitHandler } from 'react'; // Added type SubmitHandler
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as zod from 'zod';
import Image from 'next/image'; // Import next/image
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { FolderOpen, FileText, CodeXml, XCircle, Download, Info, Loader2, Upload, AlertTriangle } from 'lucide-react'; // Removed Mail, Sun, Moon
import { useToast } from '@/hooks/use-toast';
import { convertCode, getSheetNames } from './actions'; // Import server actions
// Removed useTheme import
// Removed Switch import as it's no longer used
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Link from 'next/link'; // Import Link for menu items
import { Progress } from "@/components/ui/progress"; // Import Progress component
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // Import Select components
import Chatbot from '@/components/chatbot'; // Import Chatbot component


// Define Zod schema for form validation
const FormSchema = zod.object({
  mappingFile: zod.instanceof(File, { message: "Please upload the Excel mapping file." }).refine(file => file.size > 0, "Mapping file cannot be empty."),
  inputFileOrFolder: zod.union([
    zod.instanceof(File, { message: "Please upload the Playwright Python file." }).refine(file => file.size > 0, "Input file cannot be empty."), // Single file
    zod.array(zod.instanceof(File)).min(1, "Please upload at least one Playwright Python file for folder mode.").refine(files => files.every(file => file.size > 0), "Input files cannot be empty.") // Folder (array of files)
  ]),
  isSingleFile: zod.boolean().default(false).optional(),
  selectedSheetName: zod.string().min(1, 'Please select a sheet from the mapping file.'), // Added for sheet selection
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
    // Removed state and effect related to theme switching

    return (
        <nav className="w-full flex justify-between items-baseline py-3 px-4 sm:px-6 mb-4 rounded-md bg-card/60 dark:bg-card/50 backdrop-blur-sm border border-border/30 shadow-sm">
            <div className="flex items-baseline space-x-4">
                 <span className="text-3xl font-extrabold text-primary dark:text-primary mr-6">
                    NOKIA
                 </span>
                <Link href="#" passHref>
                    <Button variant="ghost" className="hover:bg-accent/80 hover:text-accent-foreground px-3 py-1.5 h-auto">
                        <Info className="mr-2 h-4 w-4" /> About
                    </Button>
                </Link>
                {/* Removed Contact Button */}
            </div>
            {/* Removed Theme Toggle */}
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

  // File input refs
  const mappingFileInputRef = useRef<HTMLInputElement>(null);
  const inputFilesInputRef = useRef<HTMLInputElement>(null);

  // Use only dark logo path as light mode is removed
  const logoPath = '/dark.png';
  const darkLogoPlaceholder = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // 1x1 transparent pixel

  // State for the dynamically determined image source - now static
  const [imageSrc, setImageSrc] = useState(logoPath);

  // Effect to set isMounted to true after component mounts on client
  useEffect(() => {
    setIsMounted(true);
    // Set image source directly to dark logo path on mount
    setImageSrc(logoPath);
  }, []);

  // Removed effect for switching image based on theme


  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      mappingFile: undefined,
      inputFileOrFolder: undefined,
      isSingleFile: false,
      selectedSheetName: '',
    },
    mode: 'onChange',
  });

  const isSingleFile = form.watch('isSingleFile');
  const mappingFile = form.watch('mappingFile');

  // --- Fetch Sheet Names ---
  useEffect(() => {
    setSheetNames([]);
    setSheetError(null);
    form.setValue('selectedSheetName', ''); // Reset sheet selection when mapping file changes

    if (mappingFile instanceof File && mappingFile.size > 0) {
      setIsFetchingSheets(true);
      const formData = new FormData();
      formData.append('mappingFile', mappingFile);

      getSheetNames(formData)
        .then(result => {
          if (result.success && result.sheetNames) {
            setSheetNames(result.sheetNames);
            setSheetError(null);
            if (result.sheetNames.length > 0) {
              form.setValue('selectedSheetName', result.sheetNames[0], { shouldValidate: true }); // Auto-select first sheet
            } else {
              setSheetError('No sheets found in the uploaded file.');
              toast({
                  title: 'No Sheets Found',
                  description: 'The Excel file does not contain any sheets.',
                  variant: 'warning', // Use warning variant
              });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingFile]); // Rerun when mappingFile changes


  // Effect to simulate progress increase during loading
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isLoading) {
      setProgressValue(10);
      timer = setInterval(() => {
        setProgressValue((prev) => {
          if (prev >= 95) {
             if (timer) clearInterval(timer);
             return 95;
          }
          return prev + 5;
        });
      }, 150);
    } else {
       if (progressValue > 0 && progressValue < 100) {
           // Jump to 100 when loading finishes if it was in progress
           setProgressValue(100);
           // Optionally hide progress bar after a delay
            setTimeout(() => setProgressValue(0), 500);
       } else if (progressValue === 100) {
         // Hide progress bar after a short delay if it reached 100
         setTimeout(() => setProgressValue(0), 500);
       }
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]); // Depend only on isLoading


  // --- File Handling ---
  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    fieldName: 'mappingFile' | 'inputFileOrFolder'
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      form.setValue(fieldName, undefined, { shouldValidate: true });
      // Clear the input ref value as well
      if (fieldName === 'mappingFile' && mappingFileInputRef.current) {
          mappingFileInputRef.current.value = '';
          // Reset sheet state when mapping file is cleared
          setSheetNames([]);
          setSheetError(null);
          form.setValue('selectedSheetName', '', { shouldValidate: true });
      } else if (fieldName === 'inputFileOrFolder' && inputFilesInputRef.current) {
          inputFilesInputRef.current.value = '';
      }
      return;
    }

    if (fieldName === 'mappingFile') {
       if (!files[0].name.endsWith('.xlsx')) {
            toast({
                title: "Invalid File Type",
                description: "Mapping file must be an .xlsx file.",
                variant: "destructive",
            });
            form.setValue(fieldName, undefined, { shouldValidate: true });
             if (mappingFileInputRef.current) {
                 mappingFileInputRef.current.value = '';
             }
             // Reset sheet state on invalid file type
            setSheetNames([]);
            setSheetError(null);
            form.setValue('selectedSheetName', '', { shouldValidate: true });
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
             if (inputFilesInputRef.current) {
                 inputFilesInputRef.current.value = '';
             }
             return;
         }
        form.setValue(fieldName, files[0], { shouldValidate: true });
      } else {
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
          // Always clear the native input value after handling files for folder selection
          if (inputFilesInputRef.current) {
              inputFilesInputRef.current.value = '';
          }
      }
    }
  };


  const handleClearFile = (fieldName: 'mappingFile' | 'inputFileOrFolder') => {
    form.setValue(fieldName, undefined, { shouldValidate: true });
     if (fieldName === 'mappingFile' && mappingFileInputRef.current) {
       mappingFileInputRef.current.value = '';
       setSheetNames([]);
       setSheetError(null);
       form.setValue('selectedSheetName', '', { shouldValidate: true }); // Reset sheet selection too
     } else if (fieldName === 'inputFileOrFolder' && inputFilesInputRef.current) {
       inputFilesInputRef.current.value = '';
     }
    toast({
        title: "File Cleared",
        description: `Selection for ${fieldName === 'mappingFile' ? 'Mapping File' : 'Input'} cleared.`,
        variant: "default",
      });
  };


  const onSubmit: SubmitHandler<FormValues> = async (data) => {
     setIsLoading(true);
     setProgressValue(0); // Reset progress on new submission
     console.log("Form submitted, preparing FormData...");

     const formData = new FormData();
     formData.append('isSingleFile', String(data.isSingleFile));

     if (data.mappingFile instanceof File) {
         formData.append('mappingFile', data.mappingFile);
     } else {
         toast({ title: 'Error', description: 'Mapping file is missing or invalid.', variant: 'destructive' });
         setIsLoading(false);
         setProgressValue(0); // Reset progress on error
         return;
     }

     if (data.selectedSheetName) {
         formData.append('selectedSheetName', data.selectedSheetName);
     } else {
          toast({ title: 'Error', description: 'Please select a sheet from the mapping file.', variant: 'destructive' });
          setIsLoading(false);
          setProgressValue(0); // Reset progress on error
          return;
     }

     if (data.isSingleFile && data.inputFileOrFolder instanceof File) {
         formData.append('inputFileOrFolder', data.inputFileOrFolder);
     } else if (!data.isSingleFile && Array.isArray(data.inputFileOrFolder)) {
         // Ensure files are actually File objects before appending
         const validFiles = data.inputFileOrFolder.filter(file => file instanceof File);
         if (validFiles.length === 0) {
              toast({ title: 'Error', description: 'No valid input files selected for folder mode.', variant: 'destructive' });
              setIsLoading(false);
              setProgressValue(0); // Reset progress on error
              return;
         }
         validFiles.forEach(file => {
             formData.append('inputFileOrFolder', file);
         });

     } else {
          toast({ title: 'Error', description: 'Input file(s) are missing or invalid.', variant: 'destructive' });
          setIsLoading(false);
          setProgressValue(0); // Reset progress on error
          return;
     }

     try {
       console.log("Calling convertCode server action...");
       const result = await convertCode(formData);
       console.log("Server action result:", result);

       // Ensure progress reaches 100% on success or failure before showing toast/download
       setProgressValue(100);
       // Short delay to allow progress bar to visually reach 100%
       await new Promise(resolve => setTimeout(resolve, 100));


       if (result.success && result.fileName) {
         toast({
           title: 'Conversion Successful',
           description: `${result.message || 'Starting download...'}`,
           variant: "default", // Use default variant for success
         });
         if (result.fileContent) {
           triggerDownload(result.fileName, result.fileContent);
         } else if (result.zipBuffer) {
             // Convert the plain JS object (potentially from server action) back to Buffer
             const buffer = Buffer.from(result.zipBuffer);
             triggerDownload(result.fileName, buffer);
         } else {
              toast({ title: 'Download Error', description: 'No file content received.', variant: 'destructive' });
         }
       } else {
         toast({
           title: 'Conversion Failed',
           description: result.error || 'An unknown error occurred during conversion.',
           variant: 'destructive',
         });
       }
     } catch (error) {
         console.error('Error during convertCode action call or download:', error);
         setProgressValue(100); // Ensure progress shows 100% on catch
         await new Promise(resolve => setTimeout(resolve, 100)); // Delay

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
        // Don't immediately reset progress here, let the useEffect handle it after showing 100%
     }
   };


    // Function to handle image loading errors
    const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        const target = e.target as HTMLImageElement;
        // Prevent logging errors for the placeholder itself
        if (target.src !== darkLogoPlaceholder && !target.src.includes('data:image')) { // Check if not already placeholder or data URI
            console.error(`Image failed to load: ${target.src}`);
            // Fallback to a placeholder if the intended image fails
            setImageSrc(darkLogoPlaceholder);
        }
    };


  return (
    // Use dark class directly on main element as light mode is removed
    <main className="dark flex min-h-screen flex-col items-center p-4 sm:p-8 relative">

        <MenuBar />

       {/* Logo - Positioned above the card */}
       <div className="flex flex-col items-center mb-6 text-center relative">
           <div className="flex justify-center items-center mb-4 h-[240px] w-[240px] relative">
                {/* Render Image only after mount */}
                {isMounted ? (
                    <Image
                        key={imageSrc} // Key helps React manage image changes
                        src={imageSrc} // Now always uses the dark logo path
                        alt="Code Converter Logo"
                        width={240}
                        height={240}
                        className="rounded-lg object-contain bg-transparent transition-opacity duration-300 ease-in-out"
                        style={{ opacity: 1 }} // Always show when mounted
                        priority // Prioritize logo loading
                        data-ai-hint="abstract logo"
                        onError={handleImageError} // Use defined error handler
                    />
                 ) : (
                    // Static placeholder during SSR/initial mount
                    <div role="status" aria-label="Loading logo..." className="h-[240px] w-[240px] bg-muted/20 rounded-lg shadow-lg animate-pulse"></div>
                )}
           </div>
        </div>


      {/* Card for the form */}
      <Card className="w-full max-w-2xl shadow-xl backdrop-blur-[28px] bg-card/5 dark:bg-card/[0.03] border border-border/10 rounded-2xl overflow-hidden">
        {/* Applied 97% blur via backdrop-blur-[28px] approx */}
        <CardContent className="pt-6 px-6 sm:px-8">
          {/* FormProvider removed, use Form from react-hook-form directly */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                {/* Mapping File Input */}
                <FormField
                  control={form.control}
                  name="mappingFile"
                  render={({ field: { value }, fieldState }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <FileText className="h-5 w-5 text-primary" />
                        Excel Mapping File (.xlsx)
                      </FormLabel>
                      <FormControl>
                        <div className="flex flex-col sm:flex-row gap-2 items-start">
                          <Input
                            type="file"
                            accept=".xlsx"
                            ref={mappingFileInputRef}
                            onChange={(e) => handleFileChange(e, 'mappingFile')}
                            className="hidden"
                            id="mappingFileInput"
                          />
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
                           <Button
                                type="button"
                                variant="outline"
                                onClick={() => mappingFileInputRef.current?.click()}
                                className="shrink-0 dark:bg-transparent dark:text-foreground" // Removed light mode class
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
                        disabled={isFetchingSheets || sheetNames.length === 0 || !!sheetError || !mappingFile}
                      >
                        <FormControl>
                          <SelectTrigger className="bg-background/10 dark:bg-background/[0.05] border-border/20">
                            <SelectValue placeholder={
                              isFetchingSheets ? "Loading sheets..." :
                              !mappingFile ? "Upload mapping file first" :
                              sheetError ? "Error loading sheets" :
                              sheetNames.length === 0 && !isFetchingSheets ? "No sheets found" : // Added condition to avoid showing 'no sheets' while loading
                              "Select a sheet"
                            } />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sheetError && !isFetchingSheets && ( // Only show error if not fetching
                            <SelectItem value="error" disabled className="text-destructive-foreground">
                              <AlertTriangle className="inline-block mr-2 h-4 w-4" /> {sheetError}
                            </SelectItem>
                          )}
                          {!isFetchingSheets && !sheetError && sheetNames.length === 0 && mappingFile && ( // Check mappingFile exists
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
                                      const newValue = Boolean(checked); // Ensure boolean value
                                      field.onChange(newValue);
                                      // Reset input file/folder selection when mode changes
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
                  render={({ field: { value }, fieldState }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <CodeXml className="h-5 w-5 text-primary" />
                        {isSingleFile ? 'Playwright Python File (.py)' : 'Playwright Python Folder'}
                      </FormLabel>
                       <FormControl>
                          <div className="flex flex-col sm:flex-row gap-2 items-start">
                             <Input
                                type="file"
                                accept={isSingleFile ? ".py" : undefined}
                                multiple={!isSingleFile}
                                // Conditional directory attributes based on isSingleFile
                                {...(!isSingleFile ? { webkitdirectory: "true", mozdirectory: "true", odirectory: "true", directory: "true" } : {})}
                                ref={inputFilesInputRef}
                                onChange={(e) => handleFileChange(e, 'inputFileOrFolder')}
                                className="hidden"
                                id="inputFilesInput"
                             />
                              <div className="flex-grow flex items-center justify-between p-2 min-h-[40px] rounded-md border border-input bg-background/10 dark:bg-background/[0.05] border-border/20 text-sm">
                                 <span className={`truncate ${value ? 'text-foreground' : 'text-muted-foreground'}`}>
                                   {value instanceof File
                                     ? value.name
                                     : Array.isArray(value) && value.length > 0
                                     ? `${value.length} Python file(s) selected`
                                     : isSingleFile ? "No file selected" : "No folder selected"}
                                 </span>
                                 {value && (
                                   <Button type="button" variant="ghost" size="icon" onClick={() => handleClearFile('inputFileOrFolder')} className="shrink-0 text-muted-foreground hover:text-destructive h-6 w-6 ml-2" aria-label="Clear input file/folder">
                                      <XCircle className="h-4 w-4" />
                                   </Button>
                                 )}
                               </div>
                             <Button
                                type="button"
                                variant="outline"
                                onClick={() => inputFilesInputRef.current?.click()}
                                className="shrink-0 dark:bg-transparent dark:text-foreground" // Removed light mode class
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

                {/* Progress Bar and Buttons Row */}
                <div className="flex flex-col gap-4 pt-6 border-t mt-6 border-border/20">
                     {/* Conditional rendering for progress bar container */}
                     {(isLoading || progressValue > 0) && (
                        <div className={`transition-opacity duration-300 ${isLoading || progressValue > 0 ? 'opacity-100' : 'opacity-0 h-0'}`}>
                            <div className="flex items-center space-x-2">
                                <Progress value={progressValue} className="w-full h-2 transition-all duration-150 ease-linear" />
                                <span className="text-xs font-mono text-muted-foreground min-w-[40px] text-right">{`${Math.round(progressValue)}%`}</span>
                            </div>
                        </div>
                     )}

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

        {/* Chatbot Component */}
      <Chatbot />
    </main>
  );
}
