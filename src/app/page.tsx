
'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image'; // Import next/image
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label'; // Keep Label import if used elsewhere, though FormLabel is preferred within FormField
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { FolderOpen, FileText, ChevronsRight, Sun, Moon, Eye, CodeXml, XCircle } from 'lucide-react'; // Added XCircle
import { useToast } from '@/hooks/use-toast';
import { savePaths, loadPaths } from '@/lib/path-persistence';
import { convertCode } from './actions'; // Import server action
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox'; // Added Checkbox
// Import Form and other necessary form components from the UI library
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';


// Define Zod schema for form validation
const FormSchema = z.object({
  mappingFile: z.string().min(1, 'Mapping file path is required.'),
  inputFileOrFolder: z.string().min(1, 'Input file/folder path is required.'),
  isSingleFile: z.boolean().default(false).optional(), // Added checkbox state
  outputFolder: z.string().min(1, 'Output folder path is required.'),
});

type FormValues = z.infer<typeof FormSchema>;

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [viewContent, setViewContent] = useState<string | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [conversionSuccess, setConversionSuccess] = useState(false); // Track conversion success
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
    // In a real Electron or Tauri app, you'd use their APIs here.
    // For a web app, you might use <input type="file"> or a library.
    // Since we can't access the local file system directly from a standard web app,
    // we'll simulate path selection.
    const isSingleFile = form.getValues('isSingleFile');
    let simulatedPath = `/path/to/simulated/`;
    if (fieldName === 'mappingFile') {
        simulatedPath += 'mapping.xlsx';
    } else if (fieldName === 'inputFileOrFolder') {
        simulatedPath += isSingleFile ? 'playwright_script.py' : 'playwright_scripts_folder';
    } else if (fieldName === 'outputFolder') {
        simulatedPath += 'output_folder';
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
    setConversionSuccess(false); // Reset success state
    setViewContent(null); // Reset view content
    console.log("Form submitted with data:", data); // Log form data including checkbox state
    try {
      // Save paths before starting conversion
      await savePaths(data);
      toast({
        title: 'Paths Saved',
        description: 'Current paths saved as default.',
      });

      // Call the server action for conversion
      const result = await convertCode(data);

      if (result.success) {
        toast({
          title: 'Conversion Successful',
          description: result.message,
        });
        // Store simulated content for viewing
        setViewContent(result.outputContent || '*** Settings ***\nLibrary    SeleniumLibrary\n\n*** Test Cases ***\nSimulated Test Case\n    Log    Conversion successful!\n    No Operation\n');
        setConversionSuccess(true); // Mark conversion as successful
      } else {
        toast({
          title: 'Conversion Failed',
          description: result.error || 'An unknown error occurred.',
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
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 relative"> {/* Center content vertically and horizontally */}
       {/* Theme Toggle Switch */}
       <div className="absolute top-4 right-4 flex items-center space-x-2 z-10">
            <Sun className="h-5 w-5" />
            <Switch
                checked={theme === 'dark'}
                onCheckedChange={toggleTheme}
                aria-label="Toggle dark mode"
            />
            <Moon className="h-5 w-5" />
        </div>

      {/* Adjusted max-width and removed margin-top */}
      <Card className="w-full max-w-2xl shadow-xl backdrop-blur-sm bg-card/90 dark:bg-card/80 border border-border/50">
        <CardHeader className="text-center border-b pb-6">
           {/* Logo Placeholders */}
           <div className="flex justify-center items-center space-x-6 mb-4">
               <Image
                 src="https://picsum.photos/60/60?random=1" // Placeholder 1
                 alt="Logo 1"
                 width={60}
                 height={60}
                 className="rounded-full shadow-md"
               />
               <Image
                 src="https://picsum.photos/60/60?random=2" // Placeholder 2
                 alt="Logo 2"
                 width={60}
                 height={60}
                 className="rounded-full shadow-md"
               />
           </div>
          {/* Title and Description */}
          <div >
              <CardTitle className="text-3xl sm:text-4xl font-bold text-primary">Playwright to Robot Converter</CardTitle>
              <CardDescription className="text-muted-foreground mt-1">
                Select your files and output location to start the conversion.
              </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {/* Use the imported Form component which wraps FormProvider */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Mapping File Input */}
                <FormField
                  control={form.control}
                  name="mappingFile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground">
                        <FileText className="h-5 w-5 text-primary" />
                        Excel Mapping File (.xlsx)
                      </FormLabel>
                      <FormControl>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            placeholder="/path/to/your/mapping.xlsx"
                            {...field}
                            className="flex-grow"
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
                      <FormLabel className="flex items-center gap-2 text-foreground">
                        <CodeXml className="h-5 w-5 text-primary" />
                        Playwright Python Input
                      </FormLabel>
                       <FormControl>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                placeholder={form.getValues('isSingleFile') ? "/path/to/playwright/script.py" : "/path/to/playwright/scripts_folder"}
                                {...field}
                                className="flex-grow"
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
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm bg-muted/30">
                            <FormControl>
                                <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                id="isSingleFile"
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel htmlFor="isSingleFile" className="font-normal text-foreground/90 cursor-pointer">
                                The input path points to a single Python file (not a folder).
                                </FormLabel>
                            </div>
                        </FormItem>
                    )}
                    />


                {/* Output Folder Input */}
                 <FormField
                  control={form.control}
                  name="outputFolder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2 text-foreground">
                        <FolderOpen className="h-5 w-5 text-primary" />
                        Output Robot File Folder
                      </FormLabel>
                      <FormControl>
                         <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                              placeholder="/path/to/output/robot_files"
                              {...field}
                              className="flex-grow"
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
                <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t mt-8"> {/* Added border-t and mt-8 */}
                    {/* Convert Button */}
                    <Button type="submit" disabled={isLoading} className="flex-grow text-base py-3"> {/* Increased size */}
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
                        <ChevronsRight className="mr-2 h-5 w-5" /> Convert
                        </>
                    )}
                    </Button>

                    {/* View Output Button - Enabled only after successful conversion */}
                    <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                        <DialogTrigger asChild>
                            <Button
                            type="button"
                            variant="secondary"
                            disabled={!conversionSuccess || isLoading}
                            className="flex-grow text-base py-3" // Increased size
                            onClick={() => setIsViewModalOpen(true)} // Explicitly open dialog
                            >
                            <Eye className="mr-2 h-5 w-5" /> View Output
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[80vw] md:max-w-[70vw] lg:max-w-[60vw] max-h-[85vh] flex flex-col"> {/* Adjusted width */}
                            <DialogHeader>
                            <DialogTitle>Simulated Output (.robot)</DialogTitle>
                            <DialogDescription>
                                This is a preview of the generated Robot Framework file content.
                            </DialogDescription>
                            </DialogHeader>
                            <ScrollArea className="flex-grow border rounded-md p-4 my-4 bg-muted/30">
                                <pre className="text-sm whitespace-pre-wrap text-muted-foreground">{viewContent || 'No output generated yet.'}</pre>
                            </ScrollArea>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button type="button" variant="secondary">
                                    Close
                                    </Button>
                                </DialogClose>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
    

      
