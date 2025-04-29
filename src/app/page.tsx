'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image'; // Import next/image
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { FolderOpen, FileText, ChevronsRight, Sun, Moon, Eye, CodeXml } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { savePaths, loadPaths } from '@/lib/path-persistence';
import { convertCode } from './actions'; // Import server action
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';


// Define Zod schema for form validation
const FormSchema = z.object({
  mappingFile: z.string().min(1, 'Mapping file path is required.'),
  inputFileOrFolder: z.string().min(1, 'Input file/folder path is required.'),
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
      outputFolder: '',
    },
  });

  useEffect(() => {
    // Load paths from JSON file on component mount
    async function fetchPaths() {
      try {
        const paths = await loadPaths();
        if (paths) {
          form.reset(paths); // Set form values with loaded paths
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
    const simulatedPath = `/path/to/simulated/${fieldName === 'mappingFile' ? 'mapping.xlsx' : fieldName === 'inputFileOrFolder' ? 'playwright_script.py' : 'output_folder'}`;
    form.setValue(fieldName, simulatedPath);
     toast({
        title: "Path Selected (Simulated)",
        description: `Set ${fieldName} to: ${simulatedPath}`,
      });
  };


  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setIsLoading(true);
    setConversionSuccess(false); // Reset success state
    setViewContent(null); // Reset view content
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
    // Removed items-center justify-center, adjusted padding
    <main className="flex min-h-screen flex-col items-center p-4 sm:p-6 relative">
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

      <Card className="w-full max-w-2xl shadow-lg backdrop-blur-sm bg-card/90 dark:bg-card/80 border border-border/50 mt-10 sm:mt-16"> {/* Added margin-top */}
        <CardHeader className="text-center relative">
           {/* Logo Placeholders */}
           <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
               <Image
                 src="https://picsum.photos/40/40?random=1" // Placeholder 1
                 alt="Logo 1"
                 width={40}
                 height={40}
                 className="rounded-full"
               />
           </div>
            <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
               <Image
                 src="https://picsum.photos/40/40?random=2" // Placeholder 2
                 alt="Logo 2"
                 width={40}
                 height={40}
                 className="rounded-full"
               />
           </div>
          {/* Title and Description moved slightly down */}
          <div className="pt-4">
              <CardTitle className="text-2xl sm:text-3xl font-bold text-primary">Playwright to Robot Converter</CardTitle>
              <CardDescription className="text-muted-foreground">
                Select your files and output location to start the conversion.
              </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Mapping File Input */}
            <div className="space-y-2">
              <Label htmlFor="mappingFile" className="flex items-center gap-2 text-foreground">
                <FileText className="h-5 w-5 text-primary" />
                Excel Mapping File (.xlsx)
              </Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="mappingFile"
                  placeholder="/path/to/your/mapping.xlsx"
                  {...form.register('mappingFile')}
                  className="flex-grow"
                  aria-invalid={form.formState.errors.mappingFile ? 'true' : 'false'}
                />
                <Button type="button" variant="outline" onClick={() => handleBrowse('mappingFile')} className="shrink-0">
                  <FolderOpen className="mr-2 h-4 w-4" /> Browse
                </Button>
              </div>
              {form.formState.errors.mappingFile && (
                <p className="text-sm text-destructive">{form.formState.errors.mappingFile.message}</p>
              )}
            </div>

            {/* Input File/Folder Input */}
            <div className="space-y-2">
              <Label htmlFor="inputFileOrFolder" className="flex items-center gap-2 text-foreground">
                 <CodeXml className="h-5 w-5 text-primary" />
                Playwright Python File/Folder
              </Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="inputFileOrFolder"
                  placeholder="/path/to/playwright/scripts"
                  {...form.register('inputFileOrFolder')}
                  className="flex-grow"
                  aria-invalid={form.formState.errors.inputFileOrFolder ? 'true' : 'false'}
                />
                <Button type="button" variant="outline" onClick={() => handleBrowse('inputFileOrFolder')} className="shrink-0">
                  <FolderOpen className="mr-2 h-4 w-4" /> Browse
                </Button>
              </div>
              {form.formState.errors.inputFileOrFolder && (
                <p className="text-sm text-destructive">{form.formState.errors.inputFileOrFolder.message}</p>
              )}
            </div>

            {/* Output Folder Input */}
            <div className="space-y-2">
              <Label htmlFor="outputFolder" className="flex items-center gap-2 text-foreground">
                 <FolderOpen className="h-5 w-5 text-primary" /> {/* Replaced SVG with Lucide Icon */}
                Output Robot File Folder
              </Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="outputFolder"
                  placeholder="/path/to/output/robot_files"
                  {...form.register('outputFolder')}
                  className="flex-grow"
                  aria-invalid={form.formState.errors.outputFolder ? 'true' : 'false'}
                />
                <Button type="button" variant="outline" onClick={() => handleBrowse('outputFolder')} className="shrink-0">
                  <FolderOpen className="mr-2 h-4 w-4" /> Browse
                </Button>
              </div>
              {form.formState.errors.outputFolder && (
                <p className="text-sm text-destructive">{form.formState.errors.outputFolder.message}</p>
              )}
            </div>

             {/* Buttons Row */}
            <div className="flex flex-col sm:flex-row gap-4 pt-2">
                {/* Convert Button */}
                <Button type="submit" disabled={isLoading} className="flex-grow">
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
                        className="flex-grow"
                        >
                        <Eye className="mr-2 h-5 w-5" /> View Output
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[80vw] md:max-w-[60vw] lg:max-w-[50vw] max-h-[80vh] flex flex-col">
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
        </CardContent>
      </Card>
    </main>
  );
}

    