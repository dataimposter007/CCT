
'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form'; // Removed FormProvider import
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image'; // Import next/image
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
// Removed Dialog imports as they are no longer needed
import { FolderOpen, FileText, ChevronsRight, Sun, Moon, CodeXml, XCircle, Download } from 'lucide-react'; // Added Download, removed Eye
import { useToast } from '@/hooks/use-toast';
import { savePaths, loadPaths } from '@/lib/path-persistence';
import { convertCode } from './actions'; // Import server action
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
// Removed ScrollArea import as it's no longer needed
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';


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
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Clean up the object URL
}

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  // Removed state related to view modal: viewContent, isViewModalOpen, conversionSuccess
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      mappingFile: '',
      inputFileOrFolder: '',
      isSingleFile: false, // Default value for checkbox
      outputFolder: '',
    },
  });

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
  }, [form, toast]); // Dependencies

  const handleBrowse = async (fieldName: keyof FormValues) => {
    // Placeholder for actual file/folder browsing logic
    const isSingleFile = form.getValues('isSingleFile');
    let simulatedPath = `/path/to/simulated/`;
    if (fieldName === 'mappingFile') {
        simulatedPath += 'mapping.xlsx';
    } else if (fieldName === 'inputFileOrFolder') {
        simulatedPath += isSingleFile ? 'playwright_script.py' : 'playwright_scripts_folder';
    } else if (fieldName === 'outputFolder') {
        simulatedPath += 'output_folder'; // This is just for path saving consistency
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
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    // Use padding to create space around the central card instead of centering flex items
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8 relative">
       {/* Theme Toggle Switch - Positioned top right */}
       <div className="absolute top-4 right-4 flex items-center space-x-2 z-10">
            <Sun className="h-5 w-5" />
            <Switch
                checked={theme === 'dark'}
                onCheckedChange={toggleTheme}
                aria-label="Toggle dark mode"
            />
            <Moon className="h-5 w-5" />
        </div>

      {/* Card with increased max-width and slightly transparent background */}
      <Card className="w-full max-w-3xl shadow-xl backdrop-blur-sm bg-card/80 dark:bg-card/70 border border-border/40 rounded-lg overflow-hidden"> {/* Adjusted max-width, transparency, border, rounded, overflow */}
        <CardHeader className="text-center border-b pb-6 bg-card/90 dark:bg-card/80"> {/* Slightly less transparent header */}
           {/* Logo Placeholders - Increased Size */}
           <div className="flex justify-center items-center space-x-8 mb-6"> {/* Increased space-x and mb */}
               <Image
                 src="https://picsum.photos/80/80?random=1" // Increased size
                 alt="Logo 1"
                 width={80} // Increased size
                 height={80} // Increased size
                 className="rounded-full shadow-lg" // Increased shadow
               />
               <Image
                 src="https://picsum.photos/80/80?random=2" // Increased size
                 alt="Logo 2"
                 width={80} // Increased size
                 height={80} // Increased size
                 className="rounded-full shadow-lg" // Increased shadow
               />
           </div>
          {/* Title and Description */}
          <div>
              <CardTitle className="text-3xl sm:text-4xl font-bold text-primary dark:text-primary-foreground/90">Playwright to Robot Converter</CardTitle> {/* Adjusted dark mode text color */}
              <CardDescription className="text-muted-foreground mt-2"> {/* Increased mt */}
                Select your files and output location to start the conversion and download the .robot file.
              </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-8 px-6 sm:px-8"> {/* Increased padding */}
          {/* Use the imported Form component which wraps FormProvider */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Mapping File Input */}
                <FormField
                  control={form.control}
                  name="mappingFile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80"> {/* Adjusted text color */}
                        <FileText className="h-5 w-5 text-primary" />
                        Excel Mapping File (.xlsx)
                      </FormLabel>
                      <FormControl>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            placeholder="/path/to/your/mapping.xlsx"
                            {...field}
                            className="flex-grow bg-background/70 dark:bg-background/60" /* Added slight background */
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
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80"> {/* Adjusted text color */}
                        <CodeXml className="h-5 w-5 text-primary" />
                        Playwright Python Input
                      </FormLabel>
                       <FormControl>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                placeholder={form.getValues('isSingleFile') ? "/path/to/playwright/script.py" : "/path/to/playwright/scripts_folder"}
                                {...field}
                                className="flex-grow bg-background/70 dark:bg-background/60" /* Added slight background */
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
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm bg-muted/40 dark:bg-muted/30"> {/* Adjusted transparency */}
                            <FormControl>
                                <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                id="isSingleFile"
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel htmlFor="isSingleFile" className="font-normal text-foreground/80 dark:text-foreground/70 cursor-pointer"> {/* Adjusted text color */}
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
                      <FormLabel className="flex items-center gap-2 text-foreground/90 dark:text-foreground/80"> {/* Adjusted text color */}
                        <FolderOpen className="h-5 w-5 text-primary" />
                        Output Location Preference (for saving path only)
                      </FormLabel>
                      <FormControl>
                         <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                              placeholder="/path/to/remember/for/next/time"
                              {...field}
                              className="flex-grow bg-background/70 dark:bg-background/60" /* Added slight background */
                            />
                            <Button type="button" variant="outline" onClick={() => handleBrowse('outputFolder')} className="shrink-0">
                              <FolderOpen className="mr-2 h-4 w-4" /> Browse
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => handleClear('outputFolder')} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Clear output folder path">
                                <XCircle className="h-5 w-5" />
                            </Button>
                          </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />


                {/* Buttons Row */}
                <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t mt-8 border-border/40"> {/* Increased pt, Adjusted border transparency */}
                    {/* Convert Button - Now triggers download */}
                    <Button type="submit" disabled={isLoading} className="w-full text-base py-3 transition-all duration-300 ease-in-out transform hover:scale-105"> {/* Made full width, added hover effect */}
                    {isLoading ? (
                        <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Converting...
                        </>
                    ) : (
                        <>
                        <Download className="mr-2 h-5 w-5" /> Convert & Download
                        </>
                    )}
                    </Button>

                    {/* Removed the View Output button and Dialog */}
                </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
