
'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { FolderOpen, FileText, CodeXml, XCircle, Download, Info, Mail, Loader2, Sun, Moon, Upload, Sheet as SheetIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { convertCode, getSheetNames } from './actions';
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Link from 'next/link';
import { Progress } from "@/components/ui/progress";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

// Define Zod schema for CLIENT-SIDE form state
const ClientFormSchema = z.object({
  mappingFile: z.instanceof(File, { message: "Mapping file is required." }).nullable(),
  selectedSheetName: z.string().min(1, { message: "Please select a sheet." }).nullable(),
  inputFileOrFolder: z.union([
      z.instanceof(File, { message: "Input file is required." }),
      z.array(z.instanceof(File)).min(1, "At least one input file is required.")
  ]).nullable(),
  isSingleFile: z.boolean().default(false).optional(),
});

type FormValues = z.infer<typeof ClientFormSchema>;

// Helper function to trigger download
function downloadFile(filename: string, data: string | Buffer) {
    let blob: Blob;
    let mimeType: string;

    if (Buffer.isBuffer(data)) {
        mimeType = 'application/zip';
        blob = new Blob([data], { type: mimeType });
    } else {
        // Assume single file is text/plain or robot
        mimeType = filename.endsWith('.robot') ? 'text/plain;charset=utf-8' : 'application/octet-stream';
        blob = new Blob([data], { type: mimeType });
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Menu Bar Component
const MenuBar = () => {
    const [isMounted, setIsMounted] = useState(false);
    const { theme, setTheme } = useTheme();

    useEffect(() => { setIsMounted(true); }, []);

    const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

    const renderThemeToggle = () => {
        if (!isMounted) return <div className="h-8 w-[76px]"></div>; // Placeholder for layout stability
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
        <nav className="w-full flex justify-between items-baseline py-3 px-4 sm:px-6 mb-6 rounded-md bg-card/60 dark:bg-card/50 backdrop-blur-sm border border-border/30 shadow-sm">
            <div className="flex items-baseline space-x-4">
                 <span className="text-3xl font-extrabold text-primary dark:text-primary mr-6">
                    NOKIA
                 </span>
                <Link href="#" passHref>
                    <Button variant="ghost" className="hover:bg-accent/80 hover:text-accent-foreground px-3 py-1.5 h-auto">
                        <Info className="mr-2 h-4 w-4" /> About
                    </Button>
                </Link>
                <Link href="#" passHref>
                     <Button variant="ghost" className="hover:bg-accent/80 hover:text-accent-foreground px-3 py-1.5 h-auto">
                        <Mail className="mr-2 h-4 w-4" /> Contact
                    </Button>
                </Link>
            </div>
            {renderThemeToggle()}
        </nav>
    );
};


export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingSheets, setIsFetchingSheets] = useState(false);
  const [progressValue, setProgressValue] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [availableSheetNames, setAvailableSheetNames] = useState<string[]>([]);
  const { toast } = useToast();
  const { theme } = useTheme();

  // State to store the actual File objects
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [inputFiles, setInputFiles] = useState<File | File[] | null>(null);


  useEffect(() => { setIsMounted(true); }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(ClientFormSchema),
    defaultValues: {
      mappingFile: null,
      selectedSheetName: null, // Initialize sheet name as null
      inputFileOrFolder: null,
      isSingleFile: false,
    },
  });

  const isSingleFile = form.watch('isSingleFile');

  // Effect to simulate progress
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isLoading) {
      setProgressValue(10);
      timer = setInterval(() => {
        setProgressValue((prev) => {
          if (prev >= 95) { if (timer) clearInterval(timer); return 95; }
          const increment = isSingleFile ? 10 : 3;
          return Math.min(prev + increment, 95);
        });
      }, 150);
    } else if (progressValue > 0 && progressValue < 100) {
      setProgressValue(100);
      setTimeout(() => setProgressValue(0), 1500); // Reset after a delay
    }
    return () => { if (timer) clearInterval(timer); };
  }, [isLoading, progressValue, isSingleFile]);


  const triggerFileInput = (fieldName: 'mappingFile' | 'inputFileOrFolder') => {
    const input = document.getElementById(`fileInput-${fieldName}`) as HTMLInputElement | null;
    if (input) {
        input.value = ''; // Reset input value to allow re-selection of the same file/folder
        const isInputType = fieldName === 'inputFileOrFolder';
        const isSingle = form.getValues('isSingleFile');

        input.removeAttribute('webkitdirectory');
        input.removeAttribute('directory');
        input.removeAttribute('multiple');
        input.removeAttribute('accept');

        if (fieldName === 'mappingFile') {
            input.accept = ".xlsx";
        } else if (isInputType && isSingle) {
            input.accept = ".py";
        } else if (isInputType && !isSingle) {
            input.setAttribute('webkitdirectory', 'true');
            input.setAttribute('directory', 'true');
            input.multiple = true;
        }
        input.click();
    }
  };

   // Fetch sheet names when mapping file changes
   const fetchSheetNamesForFile = async (file: File) => {
       setIsFetchingSheets(true);
       setAvailableSheetNames([]); // Clear previous sheets
       form.resetField('selectedSheetName'); // Reset sheet selection in form

       const formData = new FormData();
       formData.append('mappingFile', file);

       try {
           const result = await getSheetNames(formData);
           if (result.success && result.sheetNames) {
               setAvailableSheetNames(result.sheetNames);
               toast({ title: "Sheets Loaded", description: `Found sheets: ${result.sheetNames.join(', ')}` });
           } else {
               setAvailableSheetNames([]); // Ensure sheet names are cleared on error
               toast({ title: 'Error Loading Sheets', description: result.error || 'Could not read sheets from the Excel file.', variant: 'destructive' });
           }
       } catch (error: any) {
           setAvailableSheetNames([]); // Ensure sheet names are cleared on error
           toast({ title: 'Error Loading Sheets', description: `An error occurred: ${error.message}`, variant: 'destructive' });
       } finally {
           setIsFetchingSheets(false);
       }
   };


  // Handle file selection
  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    fieldName: 'mappingFile' | 'inputFileOrFolder'
  ) => {
    const files = event.target.files;
    if (files && files.length > 0) {
        const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
        const isInputType = fieldName === 'inputFileOrFolder';
        const isSingle = form.getValues('isSingleFile');

        if (fieldName === 'mappingFile') {
            const file = files[0];
             if (file.name.endsWith('.xlsx')) {
                 setMappingFile(file);
                 form.setValue('mappingFile', file, { shouldValidate: true });
                 if(displayInput) displayInput.value = file.name;
                 fetchSheetNamesForFile(file); // Fetch sheets for the selected file
             } else {
                  toast({ title: 'Invalid File Type', description: 'Mapping file must be an .xlsx file.', variant: 'destructive' });
                  handleClear('mappingFile'); // Clear if invalid
             }
        } else if (isInputType) {
            if (isSingle) {
                const file = files[0];
                 if (file.name.endsWith('.py')) {
                     setInputFiles(file);
                     form.setValue('inputFileOrFolder', file, { shouldValidate: true });
                     if(displayInput) displayInput.value = file.name;
                 } else {
                      toast({ title: 'Invalid File Type', description: 'Input file must be a Python (.py) file.', variant: 'destructive' });
                      handleClear('inputFileOrFolder');
                 }
            } else {
                // Filter files to ensure they are valid File objects and have a non-empty webkitRelativePath
                const validFiles = Array.from(files).filter(f => f instanceof File && f.webkitRelativePath);

                const fileList = validFiles.filter(f => f.name.endsWith('.py'));

                if (validFiles.length > 0 && fileList.length === 0) {
                    toast({ title: 'No Python Files', description: 'The selected folder does not contain any Python (.py) files.', variant: 'destructive' });
                    handleClear('inputFileOrFolder');
                } else if (fileList.length > 0) {
                    setInputFiles(fileList);
                    form.setValue('inputFileOrFolder', fileList, { shouldValidate: true });
                    // Extract folder name from the first file's path
                    const folderName = fileList[0].webkitRelativePath.split('/')[0];
                    if(displayInput) displayInput.value = `${folderName} (${fileList.length} file${fileList.length > 1 ? 's' : ''})`;
                } else {
                     // Handle cases where no files are selected or only non-python files are present
                     handleClear('inputFileOrFolder');
                     if (validFiles.length > 0) { // Selected folder but only non-python files
                        toast({ title: 'No Python Files', description: 'The selected folder does not contain any Python (.py) files.', variant: 'destructive' });
                     }
                }
            }
        }
    } else {
        // Handle cancellation or no file selection
        if (fieldName === 'mappingFile') {
            handleClear('mappingFile');
        } else if (fieldName === 'inputFileOrFolder') {
            handleClear('inputFileOrFolder');
        }
    }
     // Clear the value of the hidden input to allow re-selecting the same file/folder
     if(event.target) event.target.value = '';
  };

   // Handle clearing file state and form value
   const handleClear = (fieldName: 'mappingFile' | 'inputFileOrFolder') => {
       const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
       if (fieldName === 'mappingFile') {
           setMappingFile(null);
           form.resetField('mappingFile', { defaultValue: null });
           form.resetField('selectedSheetName', { defaultValue: null }); // Reset sheet name too
           setAvailableSheetNames([]); // Clear sheet names
           if (displayInput) displayInput.value = '';
           // Clear sheet display if exists
           const sheetTrigger = document.getElementById('displayInput-selectedSheetName');
           if (sheetTrigger) {
               // For SelectTrigger, we might need to reset its visual state differently
           }
       } else if (fieldName === 'inputFileOrFolder') {
           setInputFiles(null);
           form.resetField('inputFileOrFolder', { defaultValue: null });
           if (displayInput) displayInput.value = '';
       }
       toast({
           title: "Selection Cleared",
           description: `Cleared selection for ${fieldName}.`,
           variant: "default",
           duration: 1500,
       });
   };


  const onSubmit: SubmitHandler<FormValues> = async (data) => {
     // Manually trigger validation before proceeding
     const isValid = await form.trigger();
     if (!isValid) {
         toast({ title: 'Validation Error', description: 'Please fix the errors in the form.', variant: 'destructive' });
         const firstErrorField = Object.keys(form.formState.errors)[0] as keyof FormValues | undefined;
         if (firstErrorField) {
             // Try focusing the display input associated with the error field
             const displayInput = document.getElementById(`displayInput-${firstErrorField}`);
             if (displayInput) {
                 displayInput.focus();
             } else {
                  // If display input not found (e.g., for sheet dropdown), focus the form element
                  const formElement = document.querySelector(`[name="${firstErrorField}"]`) as HTMLElement | null;
                  if (formElement) {
                     formElement.focus();
                 } else {
                    form.setFocus(firstErrorField); // Fallback to react-hook-form's focus
                 }
             }
         }
         return;
     }

    setIsLoading(true);
    setProgressValue(0);

    // --- Create FormData ---
    const formData = new FormData();

    // Append mapping file if present
    if (mappingFile) {
      formData.append('mappingFile', mappingFile);
    } else {
         toast({ title: 'Missing Input', description: 'Please select a mapping file.', variant: 'destructive' });
         setIsLoading(false);
         return;
    }
    // Append selected sheet name
    if (data.selectedSheetName) {
         formData.append('selectedSheetName', data.selectedSheetName);
    } else {
         toast({ title: 'Missing Input', description: 'Please select a sheet from the mapping file.', variant: 'destructive' });
         setIsLoading(false);
         return;
    }

     // Append input file(s)
     if (inputFiles) {
         if (Array.isArray(inputFiles)) {
             if (inputFiles.length === 0) {
                 toast({ title: 'Missing Input', description: 'Please select input files or a folder.', variant: 'destructive' });
                 setIsLoading(false);
                 return;
             }
             inputFiles.forEach(file => formData.append('inputFileOrFolder', file, file.webkitRelativePath || file.name)); // Include relative path for server processing
         } else {
             formData.append('inputFileOrFolder', inputFiles);
         }
     } else {
         toast({ title: 'Missing Input', description: 'Please select an input file or folder.', variant: 'destructive' });
         setIsLoading(false);
         return;
     }

    formData.append('isSingleFile', String(isSingleFile));

    console.log("Submitting FormData...");

    try {
      const result = await convertCode(formData);

      await new Promise(resolve => setTimeout(resolve, 50));
      setProgressValue(100);

      if (result.success && (result.fileContent || result.zipBuffer) && result.fileName) {
        toast({
          title: 'Conversion Successful',
          description: `${result.message || 'Starting download...'}`,
        });
        downloadFile(result.fileName, result.fileContent ?? result.zipBuffer!);
      } else {
        toast({
          title: 'Conversion Failed',
          description: result.error || 'An unknown error occurred.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
        console.error('Conversion process error:', error);
        await new Promise(resolve => setTimeout(resolve, 50));
        setProgressValue(100);
        toast({
            title: 'Conversion Error',
            description: error.message || 'An unexpected error occurred.',
            variant: 'destructive',
        });
    } finally {
      setIsLoading(false);
      // Keep progress at 100 for a bit before resetting
      setTimeout(() => setProgressValue(0), 1500);
    }
  };

    // Define logo paths
    const lightLogo = "/logolight.png"; // Path relative to the public directory
    const darkLogoPlaceholder = "https://picsum.photos/240/240?random=1"; // Placeholder for dark mode

    const [imageSrc, setImageSrc] = useState(lightLogo); // Initialize with light logo path

    useEffect(() => {
        if (isMounted) {
            setImageSrc(theme === 'dark' ? darkLogoPlaceholder : lightLogo);
        }
    }, [isMounted, theme]);

    const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        const target = e.target as HTMLImageElement;
        // Check if the current source is the light logo, if so, try the placeholder
        if (target.src.includes(lightLogo)) {
            console.error(`Light logo failed to load: ${target.src}. Trying placeholder.`);
            setImageSrc(darkLogoPlaceholder); // Fallback to placeholder
        } else {
            console.error(`Image failed to load: ${target.src}`);
        }
    };


  return (
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 relative">
        <MenuBar />

       <div className="flex flex-col items-center mb-6 text-center">
           <div className="relative w-60 h-60 mb-4"> {/* Container for the logo */}
                 {/* Render Image only after mount to avoid potential mismatch on initial load */}
                 {isMounted && (
                     <Image
                         key={imageSrc} // Add key to force re-render on src change
                         src={imageSrc}
                         alt="Code Converter Logo"
                         fill
                         className="rounded-lg shadow-lg object-contain bg-transparent" // Keep background transparent
                         priority={imageSrc === lightLogo} // Prioritize loading the default light logo
                         data-ai-hint="abstract logo"
                         unoptimized // Prevent Next.js optimization which might be causing issues
                         onError={handleImageError} // Use the refined error handler
                     />
                 )}
                 {!isMounted && ( // Show skeleton only if not mounted (optional, Image handles loading state)
                    <div role="status" aria-label="Loading logo..." className="absolute inset-0 bg-muted/20 rounded-lg shadow-lg animate-pulse z-10"></div>
                 )}
           </div>
        </div>

      <Card className="w-full max-w-2xl shadow-xl bg-card/5 dark:bg-card/5 backdrop-blur-[28px] border border-border/10 rounded-2xl overflow-hidden">
        <CardContent className="pt-6 px-6 sm:px-8">
           <FormProvider {...form}>
            <form onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit(onSubmit)();
            }} className="space-y-6">
                {/* Mapping File Input */}
                <FormField
                  control={form.control}
                  name="mappingFile"
                  render={({ fieldState }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <FileText className="h-5 w-5 text-primary" />
                        Excel Mapping File (.xlsx)
                      </FormLabel>
                      <FormControl>
                        <div className="flex flex-col sm:flex-row gap-2">
                           <Input
                            id="displayInput-mappingFile"
                            placeholder="Select mapping.xlsx"
                            readOnly
                            className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20 cursor-default"
                          />
                            <input
                                type="file"
                                id="fileInput-mappingFile"
                                style={{ display: 'none' }}
                                accept=".xlsx"
                                onChange={(e) => handleFileChange(e, 'mappingFile')}
                            />
                           <Button
                                type="button"
                                variant="outline"
                                onClick={() => triggerFileInput('mappingFile')}
                                className="shrink-0 bg-white/50 dark:bg-transparent"
                           >
                            <Upload className="mr-2 h-4 w-4" /> Upload
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => handleClear('mappingFile')} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Clear mapping file">
                            <XCircle className="h-5 w-5" />
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
                         <SheetIcon className="h-5 w-5 text-primary" />
                         Select Mapping Sheet
                       </FormLabel>
                       <Select
                         onValueChange={field.onChange}
                         value={field.value ?? ""} // Ensure value is controlled, use empty string for no selection
                         disabled={availableSheetNames.length === 0 || isFetchingSheets || !mappingFile}
                       >
                         <FormControl>
                           <SelectTrigger id="displayInput-selectedSheetName" className="bg-background/10 dark:bg-background/[0.05] border-border/20">
                             <SelectValue placeholder={
                               isFetchingSheets ? "Loading sheets..." :
                               !mappingFile ? "Upload mapping file first" :
                               availableSheetNames.length === 0 && !isFetchingSheets ? "No sheets found/readable" :
                               "Select a sheet"
                               } />
                           </SelectTrigger>
                         </FormControl>
                         <SelectContent>
                           {availableSheetNames.map((sheet) => (
                             <SelectItem key={sheet} value={sheet}>
                               {sheet}
                             </SelectItem>
                           ))}
                           {/* Optionally add a message if loading failed or no sheets */}
                           {!isFetchingSheets && mappingFile && availableSheetNames.length === 0 && (
                             <div className="p-2 text-sm text-muted-foreground">No valid sheets found.</div>
                           )}
                         </SelectContent>
                       </Select>
                       <FormMessage />
                     </FormItem>
                   )}
                 />


                {/* Input File/Folder Input */}
                <FormField
                  control={form.control}
                  name="inputFileOrFolder"
                  render={({ fieldState }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <CodeXml className="h-5 w-5 text-primary" />
                        Playwright Python Input (File or Folder)
                      </FormLabel>
                       <FormControl>
                          <div className="flex flex-col sm:flex-row gap-2">
                              <Input
                                id="displayInput-inputFileOrFolder"
                                placeholder={isSingleFile ? "Select script.py" : "Select scripts folder"}
                                readOnly
                                className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20 cursor-default"
                                />
                                <input
                                    type="file"
                                    id="fileInput-inputFileOrFolder"
                                    style={{ display: 'none' }}
                                    onChange={(e) => handleFileChange(e, 'inputFileOrFolder')}
                                    // Attributes like accept, webkitdirectory are set dynamically in triggerFileInput
                                />
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => triggerFileInput('inputFileOrFolder')}
                                className="shrink-0 bg-white/50 dark:bg-transparent"
                            >
                                <Upload className="mr-2 h-4 w-4" /> {isSingleFile ? 'Upload File' : 'Upload Folder'}
                            </Button>
                             <Button type="button" variant="ghost" size="icon" onClick={() => handleClear('inputFileOrFolder')} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Clear input file/folder">
                                <XCircle className="h-5 w-5" />
                             </Button>
                          </div>
                       </FormControl>
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
                                        const isChecked = checked === true; // Ensure boolean
                                        field.onChange(isChecked);
                                        // Reset inputFiles state and display when changing mode
                                        setInputFiles(null);
                                        form.setValue('inputFileOrFolder', null, { shouldValidate: true });
                                        const displayInput = document.getElementById('displayInput-inputFileOrFolder') as HTMLInputElement | null;
                                        if (displayInput) displayInput.value = '';
                                    }}
                                    id="isSingleFile"
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel htmlFor="isSingleFile" className="font-normal text-foreground/80 dark:text-foreground/70 cursor-pointer">
                                The input is a single Python file (not a folder).
                                </FormLabel>
                            </div>
                        </FormItem>
                    )}
                    />

                {/* Progress Bar and Buttons Row */}
                <div className="flex flex-col gap-4 pt-6 border-t mt-6 border-border/20">
                     <div className={`transition-opacity duration-300 ${isLoading || progressValue > 0 ? 'opacity-100 min-h-[20px]' : 'opacity-0 min-h-[0px] h-0'}`}>
                        <div className="flex items-center space-x-2">
                            <Progress value={progressValue} className="w-full h-2 transition-all duration-150 ease-linear" indicatorClassName="bg-gradient-to-r from-primary/60 to-primary"/>
                             <span className="text-xs font-mono text-muted-foreground min-w-[40px] text-right">{`${Math.round(progressValue)}%`}</span>
                        </div>
                     </div>

                    <Button type="submit" disabled={isLoading || isFetchingSheets} className="w-full text-base py-3 transition-all duration-300 ease-in-out transform hover:scale-105">
                        {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Converting...
                        </>
                        ) : isFetchingSheets ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Reading Sheets...
                        </>
                        ) : (
                        <>
                            <Download className="mr-2 h-5 w-5" /> Convert & Download
                        </>
                        )}
                    </Button>
                </div>
            </form>
           </FormProvider>
        </CardContent>
      </Card>
    </main>
  );
}

    