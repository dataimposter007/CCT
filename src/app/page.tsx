
'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form'; // Removed FormProvider import as <Form> handles it
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image'; // Import next/image
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card'; // Removed CardHeader, CardTitle, CardDescription
import { FolderOpen, FileText, ChevronsRight, Sun, Moon, CodeXml, XCircle, Download, Info, Mail, Loader2 } from 'lucide-react'; // Added Info, Mail, Loader2
import { useToast } from '@/hooks/use-toast';
import { savePaths, loadPaths } from '@/lib/path-persistence';
import { convertCode } from './actions'; // Import server action
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Link from 'next/link'; // Import Link for menu items
import { Progress } from "@/components/ui/progress"; // Import Progress component


// Define Zod schema for form validation
const FormSchema = z.object({
  mappingFile: z.string().min(1, 'Mapping file path is required.'),
  inputFileOrFolder: z.string().min(1, 'Input file/folder path is required.'),
  isSingleFile: z.boolean().default(false).optional(), // Added checkbox state
  outputFolder: z.string().min(1, 'Output folder path is required.'), // Keep for saving path
});

type FormValues = z.infer<typeof FormSchema>;

// Helper function to trigger download
function downloadFile(filename: string, content: string) {
    // Determine MIME type based on filename extension
    const mimeType = filename.endsWith('.zip') ? 'application/zip' : 'text/plain;charset=utf-8';
    const blob = new Blob([content], { type: mimeType });
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
    const { theme, setTheme } = useTheme();
    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };

    return (
        // Removed max-w-4xl and mx-auto to make it full width within its container
        // Added items-baseline for better alignment with the larger NOKIA text
        <nav className="w-full flex justify-between items-baseline py-3 px-4 sm:px-6 mb-4 rounded-md bg-card/60 dark:bg-card/50 backdrop-blur-sm border border-border/30 shadow-sm">
            <div className="flex items-baseline space-x-4"> {/* Changed items-center to items-baseline */}
                 {/* NOKIA Brand Text */}
                 <span className="text-3xl font-extrabold text-primary-foreground dark:text-primary-foreground/90 mr-6"> {/* Increased size, weight and margin */}
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
        </nav>
    );
};


export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [progressValue, setProgressValue] = useState(0); // State for progress bar
  const { toast } = useToast();


  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
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
          return prev + 5; // Increment progress
        });
      }, 150); // Adjust interval for desired speed (matches simulated delay)
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

  const handleBrowse = async (fieldName: keyof FormValues) => {
    // Placeholder for actual file/folder browsing logic
    // In a real Electron/Tauri app, you'd use dialog APIs.
    // In a web app, you'd use <input type="file"> or specific directory APIs.
    const isSingleFile = form.getValues('isSingleFile');
    const isOutput = fieldName === 'outputFolder';
    const isMapping = fieldName === 'mappingFile';

    let simulatedPath = `/path/to/simulated/`;
    if (isMapping) {
        simulatedPath += 'mapping.xlsx';
    } else if (isOutput) {
        simulatedPath += 'output_folder';
    } else { // inputFileOrFolder
        simulatedPath += isSingleFile ? 'playwright_script.py' : 'playwright_scripts_folder';
    }

    form.setValue(fieldName, simulatedPath);
     toast({
        title: "Path Selected (Simulated)",
        description: `Set ${fieldName} to: ${simulatedPath}`,
      });
  };

  const handleClear = (fieldName: keyof FormValues) => {
    form.setValue(fieldName, '');
    toast({
        title: "Path Cleared",
        description: `${fieldName} path cleared.`,
        variant: "default",
      });
  };


  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setIsLoading(true);
    setProgressValue(0); // Reset progress on new submission
    console.log("Form submitted with data:", data);
    try {
      // Save paths before starting conversion
      await savePaths(data);
      toast({
        title: 'Paths Saved',
        description: 'Current paths saved as default.',
      });

      // Call the server action for conversion
      const result = await convertCode(data);

      // Ensure progress reaches 100% even if conversion is instant
      // Use setTimeout to allow the progress bar to update visually before reaching 100
      await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
      setProgressValue(100);


      if (result.success && result.fileContent && result.fileName) {
        toast({
          title: 'Conversion Successful',
          description: `${result.message || 'Starting download...'}`,
        });
        // Trigger the download using the helper function
        downloadFile(result.fileName, result.fileContent);
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
            errorMessage = error.message;
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
                // setProgressValue(0); // Uncomment to hide bar after success/error
           }
       }, 1000); // Delay before potentially hiding
    }
  };


  return (
    // Use padding and flex to arrange elements
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 relative">

        {/* Menu Bar - Now spans full width */}
        <MenuBar />


       {/* Logo and Title - Positioned above the card */}
       <div className="flex flex-col items-center mb-6 text-center">
           {/* Single Logo Placeholder - Centered and Enlarged */}
           <div className="flex justify-center items-center mb-4">
               <Image
                 src="https://picsum.photos/240/240?random=1" // Tripled size (80*3)
                 alt="Playwright Logo"
                 width={240} // Tripled size
                 height={240} // Tripled size
                 className="rounded-full shadow-lg object-cover" // Added object-cover
               />
                {/* Removed ChevronsRight and second logo */}
           </div>
            {/* Title removed */}
             {/* Description removed from here */}
        </div>


      {/* Card for the form - Increased transparency, blur, and border radius */}
      <Card className="w-full max-w-2xl shadow-xl backdrop-blur-3xl bg-card/5 dark:bg-card/[0.03] border border-border/10 rounded-2xl overflow-hidden"> {/* Increased blur to 3xl, adjusted bg alpha, adjusted border alpha */}
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
                            placeholder="/path/to/your/mapping.xlsx"
                            {...field}
                            className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20" /* Adjusted alpha */
                          />
                          <Button type="button" variant="outline" onClick={() => handleBrowse('mappingFile')} className="shrink-0">
                            <FolderOpen className="mr-2 h-4 w-4" /> Browse
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
                        Playwright Python Input
                      </FormLabel>
                       <FormControl>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                placeholder={form.watch('isSingleFile') ? "/path/to/playwright/script.py" : "/path/to/playwright/scripts_folder"} // Use watch for dynamic placeholder
                                {...field}
                                className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20" /* Adjusted alpha */
                                />
                            <Button type="button" variant="outline" onClick={() => handleBrowse('inputFileOrFolder')} className="shrink-0">
                                <FolderOpen className="mr-2 h-4 w-4" /> Browse
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
                              placeholder="/path/to/remember/for/next/time"
                              {...field}
                              className="flex-grow bg-background/10 dark:bg-background/[0.05] border-border/20" /* Adjusted alpha */
                            />
                            <Button type="button" variant="outline" onClick={() => handleBrowse('outputFolder')} className="shrink-0">
                              <FolderOpen className="mr-2 h-4 w-4" /> Browse
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => handleClear('outputFolder')} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Clear output folder path">
                                <XCircle className="h-5 w-5" />
                            </Button>
                          </div>
                      </FormControl>
                       <p className="text-xs text-muted-foreground mt-1">This path is saved for convenience but the output file will be downloaded directly to your browser.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />


                {/* Progress Bar and Buttons Row */}
                <div className="flex flex-col gap-4 pt-6 border-t mt-6 border-border/20"> {/* Adjusted border alpha */}
                     {/* Progress Bar */}
                     {/* Always render Progress container, but control visibility with opacity */}
                     <div className={`transition-opacity duration-300 ${isLoading ? 'opacity-100' : 'opacity-0 h-0'}`}> {/* Hide container when not loading */}
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

