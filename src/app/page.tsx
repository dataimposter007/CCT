'use client';

import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { FolderOpen, FileText, CodeXml, XCircle, Download, Info, Mail, Loader2, Sun, Moon, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
// import { savePaths, loadPaths } from '@/lib/path-persistence'; // Path persistence no longer used directly in client
import { convertCode } from './actions';
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Link from 'next/link';
import { Progress } from "@/components/ui/progress";

// Define Zod schema for CLIENT-SIDE form state (focus on presence and basic type)
// Server-side handles detailed file validation.
const ClientFormSchema = z.object({
  mappingFile: z.instanceof(File, { message: "Mapping file is required." }).optional().nullable(), // Allow null initially
  inputFileOrFolder: z.union([
      z.instanceof(File, { message: "Input file is required." }),
      z.array(z.instanceof(File)).min(1, "At least one input file is required.")
  ]).optional().nullable(), // Allow null initially
  isSingleFile: z.boolean().default(false).optional(),
  outputFolder: z.string().optional(), // Keep for potential future use or remove if completely unused
});

type FormValues = z.infer<typeof ClientFormSchema>;

// Helper function to trigger download for plain text or zip buffer
function downloadFile(filename: string, data: string | Buffer) {
    let blob: Blob;
    let mimeType: string;

    if (Buffer.isBuffer(data)) {
        mimeType = 'application/zip';
        blob = new Blob([data], { type: mimeType });
    } else {
        mimeType = 'text/plain;charset=utf-8';
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

    const renderThemeToggle = () => {
        if (!isMounted) {
            return <div className="h-8 w-[76px]"></div>;
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
  const [progressValue, setProgressValue] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const { toast } = useToast();
  const { theme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement | null>(null); // Keep this ref

  // State to store the actual File objects
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [inputFiles, setInputFiles] = useState<File | File[] | null>(null);


  useEffect(() => {
    setIsMounted(true);
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(ClientFormSchema), // Use client schema (mainly for presence)
    defaultValues: {
      mappingFile: null, // Initialize with null
      inputFileOrFolder: null, // Initialize with null
      isSingleFile: false,
      outputFolder: '', // Can keep or remove based on use
    },
  });

  // Watch isSingleFile for dynamic UI changes
  const isSingleFile = form.watch('isSingleFile');

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
          const increment = isSingleFile ? 10 : 3;
          return Math.min(prev + increment, 95);
        });
      }, 150);
    } else {
        if (progressValue > 0 && progressValue < 100) {
           setProgressValue(100);
        } else if (progressValue === 100) {
          // Optional delay before hiding progress
          // setTimeout(() => setProgressValue(0), 500);
        }
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isLoading, progressValue, isSingleFile]);


  // Remove useEffect for loading paths from JSON


  const triggerFileInput = (fieldName: 'mappingFile' | 'inputFileOrFolder' | 'outputFolder') => {
    const input = document.getElementById(`fileInput-${fieldName}`) as HTMLInputElement | null;
    if (input) {
        const isInputType = fieldName === 'inputFileOrFolder';
        const isSingle = form.getValues('isSingleFile'); // Get current value

        // Reset attributes
        input.removeAttribute('webkitdirectory');
        input.removeAttribute('directory');
        input.removeAttribute('multiple');
        input.removeAttribute('accept');

        if (fieldName === 'mappingFile') {
            input.accept = ".xlsx";
        } else if (isInputType && isSingle) {
            input.accept = ".py";
        } else if (isInputType && !isSingle) {
            // Allow directory selection (browser dependent)
            input.setAttribute('webkitdirectory', 'true');
            input.setAttribute('directory', 'true');
            input.multiple = true; // Necessary for directory uploads
        } else if (fieldName === 'outputFolder') {
            // Output folder selection is just preference, not used for file ops
            input.setAttribute('webkitdirectory', 'true');
            input.setAttribute('directory', 'true');
        }

        input.click();
    }
  };


  // Handle file selection, store File objects in state and update form display value
  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    fieldName: keyof FormValues
  ) => {
    const files = event.target.files;
    if (files && files.length > 0) {
        const isInputType = fieldName === 'inputFileOrFolder';
        const isSingle = form.getValues('isSingleFile'); // Get current value

        if (fieldName === 'mappingFile') {
            const file = files[0];
            setMappingFile(file);
            form.setValue('mappingFile', file, { shouldValidate: true }); // Update form state
            // Display filename in the read-only input
            const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
            if(displayInput) displayInput.value = file.name;

        } else if (isInputType) {
            if (isSingle) {
                const file = files[0];
                setInputFiles(file);
                form.setValue('inputFileOrFolder', file, { shouldValidate: true });
                 const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
                 if(displayInput) displayInput.value = file.name;
            } else {
                // Directory/Multiple files
                const fileList = Array.from(files);
                setInputFiles(fileList);
                form.setValue('inputFileOrFolder', fileList, { shouldValidate: true });
                 const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
                 if(displayInput) displayInput.value = `${fileList.length} files selected` // Or show folder name if possible: files[0].webkitRelativePath?.split('/')[0] ||
            }
        } else if (fieldName === 'outputFolder') {
             // Handle output folder preference display (optional)
             const folderName = files[0].webkitRelativePath?.split('/')[0] || files[0].name;
             form.setValue('outputFolder', folderName); // Just save the name
             const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
             if(displayInput) displayInput.value = folderName;
        }

         // Clear the value of the hidden input to allow re-selecting the same file/folder
         event.target.value = '';

    } else {
        console.log("File selection cancelled or no files selected.");
         // Optionally clear the state if selection is cancelled
         if (fieldName === 'mappingFile') {
             setMappingFile(null);
             form.setValue('mappingFile', null);
              const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
             if(displayInput) displayInput.value = '';
         } else if (fieldName === 'inputFileOrFolder') {
             setInputFiles(null);
             form.setValue('inputFileOrFolder', null);
              const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
             if(displayInput) displayInput.value = '';
         } else if (fieldName === 'outputFolder') {
            form.setValue('outputFolder', '');
             const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
             if(displayInput) displayInput.value = '';
         }
    }
  };

   // Handle clearing the file state and form value
   const handleClear = (fieldName: keyof FormValues) => {
       const displayInput = document.getElementById(`displayInput-${fieldName}`) as HTMLInputElement | null;
       if (fieldName === 'mappingFile') {
           setMappingFile(null);
           form.setValue('mappingFile', null, { shouldValidate: true });
           if (displayInput) displayInput.value = '';
       } else if (fieldName === 'inputFileOrFolder') {
           setInputFiles(null);
           form.setValue('inputFileOrFolder', null, { shouldValidate: true });
           if (displayInput) displayInput.value = '';
       } else if (fieldName === 'outputFolder') {
           form.setValue('outputFolder', ''); // Just clear the preference string
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

     // Append input file(s)
     if (inputFiles) {
         if (Array.isArray(inputFiles)) {
             // Folder upload: append each file
             if (inputFiles.length === 0) {
                 toast({ title: 'Missing Input', description: 'Please select input files or a folder.', variant: 'destructive' });
                 setIsLoading(false);
                 return;
             }
             inputFiles.forEach(file => {
                 formData.append('inputFileOrFolder', file); // Use the same key for all files in the folder
             });
         } else {
             // Single file upload
             formData.append('inputFileOrFolder', inputFiles);
         }
     } else {
         toast({ title: 'Missing Input', description: 'Please select an input file or folder.', variant: 'destructive' });
         setIsLoading(false);
         return;
     }

    formData.append('isSingleFile', String(isSingleFile)); // Send boolean as string
    // No need to append outputFolder as the server doesn't use it for file operations

    console.log("Submitting FormData...");
    // Log FormData entries (for debugging, File objects won't show full content)
    // for (let [key, value] of formData.entries()) {
    //   console.log(`${key}:`, value);
    // }


    try {
      // Call the server action with FormData
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
          description: result.error || 'An unknown error occurred. Could not generate file.',
          variant: 'destructive',
        });
      }
    } catch (error) {
        console.error('Conversion process error:', error);
        await new Promise(resolve => setTimeout(resolve, 50));
        setProgressValue(100);
        let errorMessage = 'An unexpected error occurred during conversion.';
        if (error instanceof Error) {
             errorMessage = error.message;
        }
        toast({
            title: 'Conversion Error',
            description: errorMessage,
            variant: 'destructive',
        });
    } finally {
      setIsLoading(false);
       setTimeout(() => {
           if (progressValue === 100) {
                setProgressValue(0);
           }
       }, 1500);
    }
  };


    const lightLogo = "/logolight.png";
    const darkLogoPlaceholder = "https://picsum.photos/240/240?random=1";
    const defaultLogo = lightLogo;

    const imageSrc = isMounted && theme
      ? theme === 'dark'
        ? darkLogoPlaceholder
        : lightLogo
      : defaultLogo;

    const unoptimized = typeof imageSrc !== 'string' || imageSrc.startsWith('https://');


  return (
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 relative">

        <MenuBar />

       <div className="flex flex-col items-center mb-6 text-center">
           <div className="flex justify-center items-center mb-4">
                {isMounted ? (
                    <Image
                        key={imageSrc}
                        src={imageSrc}
                        alt="Code Converter Logo"
                        width={240}
                        height={240}
                        className="rounded-lg shadow-lg object-contain bg-transparent"
                        priority
                        data-ai-hint="abstract logo"
                         unoptimized={unoptimized}
                    />
                 ) : (
                    <div role="img" aria-label="Loading logo..." style={{ width: 240, height: 240 }} className="bg-muted/20 rounded-lg shadow-lg animate-pulse">
                       <link rel="preload" as="image" href={defaultLogo} />
                    </div>
                )}
           </div>
        </div>

      <Card className="w-full max-w-2xl shadow-xl backdrop-blur-[28px] bg-card/5 dark:bg-card/[0.03] border border-border/10 rounded-2xl overflow-hidden">
        <CardContent className="pt-6 px-6 sm:px-8">
          <Form {...form}>
            {/* Use a native <form> element when submitting FormData */}
            <form onSubmit={(e) => {
                e.preventDefault(); // Prevent default form submission
                form.handleSubmit(onSubmit)(); // Trigger react-hook-form's submit handler
            }} className="space-y-6">
                {/* Mapping File Input */}
                <FormField
                  control={form.control}
                  name="mappingFile" // Name corresponds to FormValues
                  render={({ fieldState }) => ( // Use fieldState for error display if needed
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <FileText className="h-5 w-5 text-primary" />
                        Excel Mapping File (.xlsx)
                      </FormLabel>
                      <FormControl>
                        <div className="flex flex-col sm:flex-row gap-2">
                           {/* Display Input (read-only) */}
                           <Input
                            id="displayInput-mappingFile" // ID for display
                            placeholder="Select mapping.xlsx"
                            readOnly
                            className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20 cursor-default"
                            // value={mappingFile?.name || ''} // Controlled by handleFileChange setting value
                          />
                           {/* Hidden actual file input */}
                            <input
                                type="file"
                                id="fileInput-mappingFile" // ID for triggering click
                                style={{ display: 'none' }}
                                accept=".xlsx"
                                onChange={(e) => handleFileChange(e, 'mappingFile')} // Updates state and form value
                                // 'name' attribute is not needed here as we handle it via JS state
                            />
                           {/* Upload Button triggers hidden input */}
                           <Button
                                type="button" // Important: prevent submitting the form
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
                      {/* Use FormMessage which hooks into react-hook-form validation */}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Input File/Folder Input */}
                <FormField
                  control={form.control}
                  name="inputFileOrFolder" // Name corresponds to FormValues
                  render={({ fieldState }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <CodeXml className="h-5 w-5 text-primary" />
                        Playwright Python Input (File or Folder)
                      </FormLabel>
                       <FormControl>
                          <div className="flex flex-col sm:flex-row gap-2">
                              {/* Display Input (read-only) */}
                              <Input
                                id="displayInput-inputFileOrFolder"
                                placeholder={isSingleFile ? "Select script.py" : "Select scripts folder"}
                                readOnly
                                className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20 cursor-default"
                                // value={
                                //     inputFiles
                                //     ? Array.isArray(inputFiles)
                                //         ? `${inputFiles.length} files selected`
                                //         : inputFiles.name
                                //     : ''
                                // } // Controlled by handleFileChange
                                />
                             {/* Hidden actual file input */}
                                <input
                                    type="file"
                                    id="fileInput-inputFileOrFolder" // ID for triggering click
                                    style={{ display: 'none' }}
                                    // Attributes set dynamically
                                    onChange={(e) => handleFileChange(e, 'inputFileOrFolder')} // Updates state and form value
                                     // 'name' attribute is not needed here
                                />
                             {/* Upload Button triggers hidden input */}
                            <Button
                                type="button" // Prevent form submission
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
                    render={({ field }) => ( // field object contains onChange, value, etc.
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border border-border/20 p-3 shadow-sm bg-muted/[0.05] dark:bg-muted/[0.03]">
                            <FormControl>
                                <Checkbox
                                    checked={field.value}
                                    onCheckedChange={(checked) => {
                                        field.onChange(checked);
                                        // Reset inputFiles state when changing mode
                                        setInputFiles(null);
                                        form.setValue('inputFileOrFolder', null, { shouldValidate: true }); // Reset form value too
                                        const displayInput = document.getElementById('displayInput-inputFileOrFolder') as HTMLInputElement | null;
                                        if (displayInput) displayInput.value = '';
                                    }}
                                    id="isSingleFile"
                                    // name={field.name} // RHF handles name via control
                                    // ref={field.ref} // RHF handles ref
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel htmlFor="isSingleFile" className="font-normal text-foreground/80 dark:text-foreground/70 cursor-pointer">
                                The input is a single Python file (not a folder).
                                </FormLabel>
                            </div>
                             {/* <FormMessage /> RHF usually shows message below the control group */}
                        </FormItem>
                    )}
                    />


                 {/* Output Folder Input - Preference Only */}
                 <FormField
                  control={form.control}
                  name="outputFolder"
                  render={({ field }) => ( // Use field directly for display value
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <FolderOpen className="h-5 w-5 text-primary" />
                        Output Location Preference (Optional)
                      </FormLabel>
                      <FormControl>
                         <div className="flex flex-col sm:flex-row gap-2">
                            {/* Display Input (read-only) */}
                             <Input
                              id="displayInput-outputFolder"
                              placeholder="Select preferred output folder (optional)"
                              readOnly
                              value={field.value || ''} // Display value from form state
                              className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20 cursor-default"
                            />
                             {/* Hidden actual file input */}
                                <input
                                    type="file"
                                    id="fileInput-outputFolder"
                                    style={{ display: 'none' }}
                                    webkitdirectory="true"
                                    directory="true"
                                    onChange={(e) => handleFileChange(e, 'outputFolder')}
                                     // 'name' attribute not directly used for control
                                />
                             {/* Upload Button triggers hidden input */}
                            <Button
                                type="button" // Prevent form submission
                                variant="outline"
                                onClick={() => triggerFileInput('outputFolder')}
                                className="shrink-0 bg-white/50 dark:bg-transparent"
                            >
                              <Upload className="mr-2 h-4 w-4" /> Select Folder
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => handleClear('outputFolder')} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Clear output folder preference">
                                <XCircle className="h-5 w-5" />
                            </Button>
                          </div>
                      </FormControl>
                       <p className="text-xs text-muted-foreground mt-1">The converted file(s) will be downloaded directly via your browser.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />


                {/* Progress Bar and Buttons Row */}
                <div className="flex flex-col gap-4 pt-6 border-t mt-6 border-border/20">
                     <div className={`transition-opacity duration-300 ${isLoading || progressValue > 0 ? 'opacity-100 min-h-[20px]' : 'opacity-0 min-h-[0px] h-0'}`}>
                        <div className="flex items-center space-x-2">
                            <Progress value={progressValue} className="w-full h-2 transition-all duration-150 ease-linear" />
                             <span className="text-xs font-mono text-muted-foreground min-w-[40px] text-right">{`${Math.round(progressValue)}%`}</span>
                        </div>
                     </div>

                    <Button type="submit" disabled={isLoading} className="w-full text-base py-3 transition-all duration-300 ease-in-out transform hover:scale-105">
                        {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Converting...
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
