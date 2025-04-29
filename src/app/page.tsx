
'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image'; // Import next/image
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FolderOpen, FileText, ChevronsRight, Sun, Moon, CodeXml, XCircle, Download, Info, Mail } from 'lucide-react'; // Added Info, Mail
import { useToast } from '@/hooks/use-toast';
import { savePaths, loadPaths } from '@/lib/path-persistence';
import { convertCode } from './actions'; // Import server action
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Link from 'next/link'; // Import Link for menu items


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
        <nav className="w-full max-w-4xl mx-auto flex justify-between items-center py-3 px-4 sm:px-6 mb-4 rounded-md bg-card/60 dark:bg-card/50 backdrop-blur-sm border border-border/30 shadow-sm">
            <div className="flex items-center space-x-4">
                <Link href="#" passHref>
                    <Button variant="ghost" className="hover:bg-accent hover:text-accent-foreground px-3 py-1.5 h-auto">
                        <Info className="mr-2 h-4 w-4" /> About
                    </Button>
                </Link>
                <Link href="#" passHref>
                     <Button variant="ghost" className="hover:bg-accent hover:text-accent-foreground px-3 py-1.5 h-auto">
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


  return (
    // Use padding and flex to arrange elements
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 relative">

        {/* Menu Bar */}
        <MenuBar />


       {/* Logos and Title - Positioned above the card */}
       <div className="flex flex-col items-center mb-6 text-center">
           {/* Logo Placeholders - Increased Size */}
           <div className="flex justify-center items-center space-x-8 mb-4">
               <Image
                 src="https://picsum.photos/80/80?random=1" // Increased size
                 alt="Playwright Logo"
                 width={80} // Increased size
                 height={80} // Increased size
                 className="rounded-full shadow-lg object-cover" // Added object-cover
               />
                <ChevronsRight className="h-10 w-10 text-primary dark:text-primary-foreground/80" />
               <Image
                 src="https://picsum.photos/80/80?random=2" // Increased size
                 alt="Robot Framework Logo"
                 width={80} // Increased size
                 height={80} // Increased size
                 className="rounded-full shadow-lg object-cover" // Added object-cover
               />
           </div>
            {/* Title and Description outside card */}
           <h1 className="text-3xl sm:text-4xl font-bold text-primary dark:text-primary-foreground/90 mt-4"> {/* Use h1 */}
                Playwright to Robot Converter
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl"> {/* Use p */}
                Select your Playwright Python file(s) and Excel mapping file, choose an output location preference, and convert them to Robot Framework test cases.
            </p>
        </div>


      {/* Card for the form */}
      <Card className="w-full max-w-2xl shadow-xl backdrop-blur-sm bg-card/80 dark:bg-card/70 border border-border/40 rounded-lg overflow-hidden"> {/* Slightly smaller max-width */}
        {/* CardHeader can be removed if Title/Description are outside */}
        {/* <CardHeader className="text-center border-b pb-4 bg-card/90 dark:bg-card/80">
        </CardHeader> */}
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
                            className="flex-grow bg-background/70 dark:bg-background/60"
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
                                placeholder={form.getValues('isSingleFile') ? "/path/to/playwright/script.py" : "/path/to/playwright/scripts_folder"}
                                {...field}
                                className="flex-grow bg-background/70 dark:bg-background/60"
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
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm bg-muted/40 dark:bg-muted/30">
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
                              className="flex-grow bg-background/70 dark:bg-background/60"
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


                {/* Buttons Row */}
                <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t mt-6 border-border/40"> {/* Reduced pt/mt */}
                    {/* Convert Button - Now triggers download */}
                    <Button type="submit" disabled={isLoading} className="w-full text-base py-3 transition-all duration-300 ease-in-out transform hover:scale-105">
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
                </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
