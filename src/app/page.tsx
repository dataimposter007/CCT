
'use client';

import type React from 'react';
import { useState, useEffect, useRef } from 'react'; // Added useRef
import { useForm, type SubmitHandler } from 'react-hook-form'; // Removed FormProvider import as <Form> handles it
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image'; // Import next/image
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card'; // Removed CardHeader, CardTitle, CardDescription
import { FolderOpen, FileText, CodeXml, XCircle, Download, Info, Mail, Loader2, Sun, Moon, Upload } from 'lucide-react'; // Added Upload, Info, Mail, Loader2, Sun, Moon
import { useToast } from '@/hooks/use-toast';
import { savePaths, loadPaths } from '@/lib/path-persistence';
import { convertCode } from './actions'; // Import server action
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Link from 'next/link'; // Import Link for menu items
import { Progress } from "@/components/ui/progress"; // Import Progress component


// Define Zod schema for form validation (CLIENT-SIDE ONLY version - doesn't check file existence)
// Server-side validation handles file existence checks.
const ClientFormSchema = z.object({
  mappingFile: z.string().min(1, 'Mapping file path is required.')
    .refine(value => value.endsWith('.xlsx'), { message: 'Mapping file must be an .xlsx file.' }),
  inputFileOrFolder: z.string().min(1, 'Input file/folder path is required.'),
  isSingleFile: z.boolean().default(false).optional(), // Added checkbox state
  outputFolder: z.string().min(1, 'Output folder path is required.'), // Keep for saving path
});


type FormValues = z.infer<typeof ClientFormSchema>;

// Helper function to trigger download for plain text or zip buffer
function downloadFile(filename: string, data: string | Buffer) {
    let blob: Blob;
    let mimeType: string;

    if (Buffer.isBuffer(data)) {
        // Handle zip buffer
        mimeType = 'application/zip';
        blob = new Blob([data], { type: mimeType });
    } else {
        // Handle plain text (.robot file content)
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
  const [progressValue, setProgressValue] = useState(0); // State for progress bar
  const [isMounted, setIsMounted] = useState(false); // State to track client mount
  const { toast } = useToast();
  const { theme } = useTheme(); // Get current theme
  const fileInputRef = useRef<HTMLInputElement | null>(null); // Ref for file input

  // Effect to set isMounted to true after component mounts on client
  useEffect(() => {
    setIsMounted(true);
  }, []);

   // Debugging: Log theme value when it changes and after mount
  useEffect(() => {
    if (isMounted) {
      // console.log("Current theme (mounted):", theme);
    }
  }, [theme, isMounted]);


  const form = useForm<FormValues>({
    resolver: zodResolver(ClientFormSchema), // Use client-side schema
    defaultValues: {
      mappingFile: '',
      inputFileOrFolder: '',
      isSingleFile: false, // Default value for checkbox
      outputFolder: '',
    },
  });

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
          // Simulate slower progress for larger tasks (like folder conversion)
          const increment = form.getValues('isSingleFile') ? 10 : 3;
          return Math.min(prev + increment, 95); // Ensure it doesn't jump over 95 here
        });
      }, 150); // Adjust interval for desired speed
    } else {
       // If loading finishes quickly or is cancelled, ensure progress reaches 100
        if (progressValue > 0 && progressValue < 100) {
           setProgressValue(100);
           // Optional: Hide progress bar after a short delay
           // setTimeout(() => setProgressValue(0), 500);
        } else if (progressValue === 100) {
           // Optional: Hide progress bar after a short delay
          // setTimeout(() => setProgressValue(0), 500);
        }
       // else progress is 0, do nothing
    }

    return () => { // Cleanup interval on unmount or when isLoading changes
      if (timer) clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, progressValue]); // Added progressValue dependency to handle setting to 100% correctly


  useEffect(() => {
    // Load paths from JSON file on component mount
    async function fetchPaths() {
      try {
        const paths = await loadPaths();
        if (paths) {
          // Ensure isSingleFile is also loaded if present, otherwise use default
          form.reset({ ...paths, isSingleFile: paths.isSingleFile ?? false });
          toast({
            title: 'Paths Loaded',
            description: 'Default paths loaded successfully.',
             duration: 2000, // Shorter duration for info toasts
          });
        }
      } catch (error) {
         console.error('Failed to load paths:', error);
         // Don't show toast if file doesn't exist initially
         if (error instanceof Error && !error.message.includes('ENOENT') && !error.message.includes('Failed to load paths')) {
             // Avoid showing error if it's just the file not found or the generic load error
            toast({
                title: 'Error Loading Paths',
                description: 'Could not load default paths. Please select manually.',
                variant: 'destructive',
            });
         }
      }
    }
    fetchPaths();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- form should only be initialized once
  }, [toast]); // Removed form from dependency array to prevent potential re-runs


  // Function to trigger the hidden file input click
  const triggerFileInput = (fieldName: keyof FormValues) => {
    const input = document.getElementById(`fileInput-${fieldName}`) as HTMLInputElement | null;
    if (input) {
        // Determine attributes based on field name and state
        const isSingle = form.getValues('isSingleFile');
        const isMapping = fieldName === 'mappingFile';
        const isInputPy = fieldName === 'inputFileOrFolder' && isSingle;
        const isInputFolder = fieldName === 'inputFileOrFolder' && !isSingle;

        // Reset attributes before click
        input.removeAttribute('webkitdirectory');
        input.removeAttribute('directory');
        input.removeAttribute('multiple');
        input.removeAttribute('accept');

        if (isMapping) {
            input.accept = ".xlsx";
        } else if (isInputPy) {
            input.accept = ".py";
        } else if (isInputFolder) {
            // Allow directory selection
            input.setAttribute('webkitdirectory', 'true');
            input.setAttribute('directory', 'true');
            // Optionally allow multiple files within the directory if needed by backend logic later
            // input.multiple = true;
        } else if (fieldName === 'outputFolder') {
            // Directory selection for output preference (though not used for actual output)
            input.setAttribute('webkitdirectory', 'true');
            input.setAttribute('directory', 'true');
        }

        input.click();
    }
  };

  // Function to handle file selection change
  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    fieldName: keyof FormValues
  ) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const selectedPath = files[0].name; // Use file name as placeholder
      // IMPORTANT: Browser security prevents getting the full path.
      // The backend logic currently expects full paths. This will need adjustment
      // either in the frontend (e.g., using electron/tauri) or backend to handle file uploads.
      // For now, we set the *file name* or a *simulated* folder path in the form.
      let displayValue = selectedPath;
       const isInputFolder = fieldName === 'inputFileOrFolder' && !form.getValues('isSingleFile');
       const isOutputFolder = fieldName === 'outputFolder';

       if (isInputFolder || isOutputFolder) {
            // For folder selection, the 'name' is often just the folder name.
            // We can try to get a relative path if available (browser dependent)
            // Or just use the name. The backend CANNOT get the full path from this.
             const relativePath = (files[0] as any).webkitRelativePath; // Non-standard, might not exist
             displayValue = relativePath ? relativePath.split('/')[0] : files[0].name; // Show top-level folder name
            form.setValue(fieldName, `/simulated/path/to/${displayValue}`); // MUST simulate full path for backend
            console.warn(`Selected folder: ${displayValue}. Full path access is not possible in standard web browsers. Simulating path for backend.`);

        } else {
            form.setValue(fieldName, `/simulated/path/to/${displayValue}`); // MUST simulate full path for backend
             console.warn(`Selected file: ${displayValue}. Full path access is not possible in standard web browsers. Simulating path for backend.`);
        }

        // console.log(`File/Folder selected for ${fieldName}: ${displayValue}`);

       // Optionally, show a success toast
       // toast({
       //   title: "Selection Updated",
       //   description: `${fieldName} set to ${displayValue}. Note: Full path is not available.`,
       //   duration: 3000,
       // });

    } else {
        // Handle case where selection is cancelled
        console.log("File selection cancelled.");
    }

     // Reset the input value to allow selecting the same file again
     event.target.value = '';
  };


  const handleClear = (fieldName: keyof FormValues) => {
    form.setValue(fieldName, '');
    toast({
        title: "Path Cleared",
        description: `${fieldName} path cleared.`,
        variant: "default",
         duration: 1500,
      });
  };


 const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setIsLoading(true);
    setProgressValue(0); // Reset progress on new submission
    console.log("Form submitted with client data:", data);
    console.warn("Submitting simulated full paths. Ensure backend handles this or uses file uploads.");

    // Perform client-side validation again before submitting (optional redundancy)
    const validation = ClientFormSchema.safeParse(data);
    if (!validation.success) {
        toast({
            title: 'Invalid Input',
            description: validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
            variant: 'destructive',
        });
        setIsLoading(false);
        return;
    }


    try {
      // Save paths before starting conversion (consider doing this only on success?)
      await savePaths(data);
      toast({
        title: 'Paths Saved',
        description: 'Current paths saved as default.',
        duration: 2000,
      });

      // Call the server action for conversion
      // IMPORTANT: Sending simulated paths from 'data'. Backend needs to be aware.
      const result = await convertCode(data);

      // Ensure progress reaches 100% even if conversion is fast
      await new Promise(resolve => setTimeout(resolve, 50)); // Small delay for UI update
      setProgressValue(100);


      if (result.success && (result.fileContent || result.zipBuffer) && result.fileName) {
        toast({
          title: 'Conversion Successful',
          description: `${result.message || 'Starting download...'}`,
        });
        // Trigger download: Pass either fileContent (string) or zipBuffer (Buffer)
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
        // Ensure progress reaches 100 on error as well
        await new Promise(resolve => setTimeout(resolve, 50));
        setProgressValue(100);
        let errorMessage = 'An unexpected error occurred during conversion.';
        if (error instanceof Error) {
            // Provide more specific feedback for common errors
            if (error.message.includes('ENOENT') || error.message.includes('not found')) {
                errorMessage = 'File or folder not found on server. Please check the simulated paths or ensure backend can access them.';
            } else if (error.message.includes('permission')) {
                errorMessage = 'Permission denied on server. Check file/folder permissions.';
            } else {
                 errorMessage = error.message;
            }
        }
        toast({
            title: 'Conversion Error',
            description: errorMessage,
            variant: 'destructive',
        });
    } finally {
      setIsLoading(false);
       // Optional: Reset progress bar after a short delay, ensuring it was 100 first
       setTimeout(() => {
           if (progressValue === 100) { // Check if it actually reached 100
                setProgressValue(0); // Reset progress bar after completion/error
           }
       }, 1500); // Delay before hiding/resetting
    }
  };


   // Determine image source based on theme, but only after mount
    const lightLogo = "/logolight.png"; // Path to the local light mode logo in public folder
    const darkLogoPlaceholder = "https://picsum.photos/240/240?random=1"; // Using placeholder for dark

    // Use a default valid source before hydration to prevent the error
    const defaultLogo = lightLogo; // Use light logo as a safe default

    // Calculate imageSrc *only after mount* and ensure theme is defined
    const imageSrc = isMounted && theme
      ? theme === 'dark'
        ? darkLogoPlaceholder
        : lightLogo
      : defaultLogo; // Use defaultLogo before mount

     // Determine if optimization should be disabled (only for external URLs or non-string paths)
     const unoptimized = typeof imageSrc !== 'string' || imageSrc.startsWith('https://');


  return (
    // Use padding and flex to arrange elements
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 relative">

        {/* Menu Bar - Now spans full width */}
        <MenuBar />


       {/* Logo and Title - Positioned above the card */}
       <div className="flex flex-col items-center mb-6 text-center">
           {/* Single Logo Placeholder - Centered and Enlarged */}
           <div className="flex justify-center items-center mb-4">
               {/* Render Image only after mount to avoid hydration error */}
                {isMounted ? (
                    <Image
                        key={imageSrc} // Add key to force re-render on src change if needed
                        src={imageSrc}
                        alt="Code Converter Logo"
                        width={240} // Tripled size
                        height={240} // Tripled size
                        className="rounded-lg shadow-lg object-contain bg-transparent" // Added bg-transparent
                        priority // Prioritize loading the logo
                        data-ai-hint="abstract logo"
                        // Disable optimization only for external URLs or if src isn't a string
                         unoptimized={unoptimized}
                    />
                 ) : (
                    // Placeholder div with the same dimensions, using the default logo src
                    // Adding role and aria-label for accessibility during loading state
                    <div role="img" aria-label="Loading logo..." style={{ width: 240, height: 240 }} className="bg-muted/20 rounded-lg shadow-lg animate-pulse">
                       {/* Preload the default image to potentially improve LCP */}
                       <link rel="preload" as="image" href={defaultLogo} />
                    </div>
                )}
                {/* Removed ChevronsRight and second logo */}
           </div>
            {/* Title removed */}
             {/* Description removed from here */}
        </div>


      {/* Card for the form - Increased transparency, blur, and border radius */}
      {/* Adjusted backdrop blur to 'backdrop-blur-[28px]' which is close to 97% if 30px is 100% */}
      <Card className="w-full max-w-2xl shadow-xl backdrop-blur-[28px] bg-card/5 dark:bg-card/[0.03] border border-border/10 rounded-2xl overflow-hidden">
        <CardContent className="pt-6 px-6 sm:px-8"> {/* Adjusted padding */}
          {/* Use the imported Form component which wraps FormProvider */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Mapping File Input */}
                <FormField
                  control={form.control}
                  name="mappingFile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <FileText className="h-5 w-5 text-primary" />
                        Excel Mapping File (.xlsx)
                      </FormLabel>
                      <FormControl>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            placeholder="Select mapping.xlsx" // Updated placeholder
                            {...field} // Spread field props first
                            value={field.value?.split('/').pop() || ''} // Display only file name
                            readOnly // Make input read-only, value set by file picker
                            className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20 cursor-default" /* Adjusted alpha */
                          />
                           {/* Hidden actual file input */}
                            <input
                                type="file"
                                id="fileInput-mappingFile"
                                style={{ display: 'none' }}
                                accept=".xlsx" // Accept only Excel files
                                onChange={(e) => handleFileChange(e, 'mappingFile')}
                            />
                           {/* Upload Button triggers hidden input */}
                           <Button
                                type="button"
                                variant="outline"
                                onClick={() => triggerFileInput('mappingFile')} // Trigger file input
                                className="shrink-0 bg-white/50 dark:bg-transparent"
                           >
                            <Upload className="mr-2 h-4 w-4" /> Upload
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => handleClear('mappingFile')} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Clear mapping file path">
                            <XCircle className="h-5 w-5" />
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Input File/Folder Input */}
                <FormField
                  control={form.control}
                  name="inputFileOrFolder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <CodeXml className="h-5 w-5 text-primary" />
                        Playwright Python Input (File or Folder)
                      </FormLabel>
                       <FormControl>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                placeholder={form.watch('isSingleFile') ? "Select script.py" : "Select scripts folder"} // Dynamic placeholder
                                {...field} // Spread field props first
                                value={field.value?.split('/').pop() || ''} // Display only file/folder name
                                readOnly // Make input read-only
                                className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20 cursor-default" /* Adjusted alpha */
                                />
                             {/* Hidden actual file input */}
                                <input
                                    type="file"
                                    id="fileInput-inputFileOrFolder"
                                    style={{ display: 'none' }}
                                    // Attributes 'accept', 'webkitdirectory', 'directory' are set dynamically in triggerFileInput
                                    onChange={(e) => handleFileChange(e, 'inputFileOrFolder')}
                                />
                             {/* Upload Button triggers hidden input */}
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => triggerFileInput('inputFileOrFolder')} // Trigger file input
                                className="shrink-0 bg-white/50 dark:bg-transparent"
                            >
                                <Upload className="mr-2 h-4 w-4" /> {form.watch('isSingleFile') ? 'Upload File' : 'Upload Folder'}
                            </Button>
                             <Button type="button" variant="ghost" size="icon" onClick={() => handleClear('inputFileOrFolder')} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Clear input file/folder path">
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
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border border-border/20 p-3 shadow-sm bg-muted/[0.05] dark:bg-muted/[0.03]"> {/* Adjusted border and bg alpha */}
                            <FormControl>
                                <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                id="isSingleFile"
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel htmlFor="isSingleFile" className="font-normal text-foreground/80 dark:text-foreground/70 cursor-pointer">
                                The input path points to a single Python file (not a folder).
                                </FormLabel>
                            </div>
                        </FormItem>
                    )}
                    />


                {/* Output Folder Input - Still useful for saving the preference */}
                 <FormField
                  control={form.control}
                  name="outputFolder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80">
                        <FolderOpen className="h-5 w-5 text-primary" />
                        Output Location Preference (for saving path only)
                      </FormLabel>
                      <FormControl>
                         <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                              placeholder="Select preferred output folder" // Updated placeholder
                              {...field} // Spread field props first
                              value={field.value?.split('/').pop() || ''} // Display only folder name
                              readOnly // Make input read-only
                              className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20 cursor-default" /* Adjusted alpha */
                            />
                             {/* Hidden actual file input */}
                                <input
                                    type="file" // Use type="file" even for directories
                                    id="fileInput-outputFolder"
                                    style={{ display: 'none' }}
                                    webkitdirectory="true" // Request directory selection
                                    directory="true" // Standard attribute for directory
                                    onChange={(e) => handleFileChange(e, 'outputFolder')}
                                />
                             {/* Upload Button triggers hidden input */}
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => triggerFileInput('outputFolder')} // Trigger file input
                                className="shrink-0 bg-white/50 dark:bg-transparent"
                            >
                              <Upload className="mr-2 h-4 w-4" /> Upload Folder
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => handleClear('outputFolder')} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Clear output folder path">
                                <XCircle className="h-5 w-5" />
                            </Button>
                          </div>
                      </FormControl>
                       <p className="text-xs text-muted-foreground mt-1">This path is saved for convenience but the output file will be downloaded directly to your browser's default download location.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />


                {/* Progress Bar and Buttons Row */}
                <div className="flex flex-col gap-4 pt-6 border-t mt-6 border-border/20"> {/* Adjusted border alpha */}
                     {/* Progress Bar */}
                     {/* Always render Progress container, but control visibility with opacity */}
                     <div className={`transition-opacity duration-300 ${isLoading || progressValue > 0 ? 'opacity-100 min-h-[20px]' : 'opacity-0 min-h-[0px] h-0'}`}> {/* Make visible if loading or if progress is > 0, ensure space */}
                        <div className="flex items-center space-x-2">
                            <Progress value={progressValue} className="w-full h-2 transition-all duration-150 ease-linear" />
                             <span className="text-xs font-mono text-muted-foreground min-w-[40px] text-right">{`${Math.round(progressValue)}%`}</span>
                        </div>
                     </div>

                     {/* Convert Button */}
                    <Button type="submit" disabled={isLoading} className="w-full text-base py-3 transition-all duration-300 ease-in-out transform hover:scale-105">
                        {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> {/* Use Loader2 for a standard spinner */}
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

    