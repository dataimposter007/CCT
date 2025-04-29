'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FolderOpen, FileText, ChevronsRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { savePaths, loadPaths } from '@/lib/path-persistence';
import { convertCode } from './actions'; // Import server action

// Define Zod schema for form validation
const FormSchema = z.object({
  mappingFile: z.string().min(1, 'Mapping file path is required.'),
  inputFileOrFolder: z.string().min(1, 'Input file/folder path is required.'),
  outputFolder: z.string().min(1, 'Output folder path is required.'),
});

type FormValues = z.infer<typeof FormSchema>;

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
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
         if (error instanceof Error && !error.message.includes('ENOENT')) {
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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8 md:p-12">
      <Card className="w-full max-w-2xl shadow-lg backdrop-blur-sm bg-card/80">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl sm:text-3xl font-bold text-primary">Playwright to Robot Converter</CardTitle>
          <CardDescription className="text-muted-foreground">
            Select your files and output location to start the conversion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Mapping File Input */}
            <div className="space-y-2">
              <Label htmlFor="mappingFile" className="flex items-center gap-2 text-foreground">
                <FileText className="h-5 w-5 text-primary" />
                Excel Mapping File
              </Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="mappingFile"
                  placeholder="/path/to/your/mapping.xlsx"
                  {...form.register('mappingFile')}
                  className="flex-grow"
                  aria-invalid={form.formState.errors.mappingFile ? 'true' : 'false'}
                />
                <Button type="button" variant="outline" onClick={() => handleBrowse('mappingFile')} className="shrink-0 transition-colors duration-200 hover:bg-accent hover:text-accent-foreground">
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
                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="m10 13-2 2 2 2"></path><path d="m14 17 2-2-2-2"></path></svg>
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
                <Button type="button" variant="outline" onClick={() => handleBrowse('inputFileOrFolder')} className="shrink-0 transition-colors duration-200 hover:bg-accent hover:text-accent-foreground">
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
                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>
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
                <Button type="button" variant="outline" onClick={() => handleBrowse('outputFolder')} className="shrink-0 transition-colors duration-200 hover:bg-accent hover:text-accent-foreground">
                  <FolderOpen className="mr-2 h-4 w-4" /> Browse
                </Button>
              </div>
              {form.formState.errors.outputFolder && (
                <p className="text-sm text-destructive">{form.formState.errors.outputFolder.message}</p>
              )}
            </div>

            {/* Convert Button */}
            <Button type="submit" disabled={isLoading} className="w-full transition-colors duration-200 hover:bg-primary/90">
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
