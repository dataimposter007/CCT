
'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { motion } from 'framer-motion';
import { Upload, FileText, GitBranch, Settings, Terminal, Download, CheckCircle } from 'lucide-react';

interface AboutDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const stepVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.2,
      duration: 0.5,
      ease: 'easeOut',
    },
  }),
};

const arrowVariants = {
  hidden: { opacity: 0, pathLength: 0 },
  visible: (i: number) => ({
    opacity: 1,
    pathLength: 1,
    transition: {
      delay: (i + 0.5) * 0.2,
      duration: 0.4,
      ease: 'easeInOut',
    },
  }),
};

const steps = [
  { icon: Upload, title: 'Upload Files', description: 'Select Playwright (.py) file(s) and the Excel mapping file (.xlsx).' },
  { icon: FileText, title: 'Select Sheet', description: 'Choose the correct sheet containing the Playwright-to-Robot mapping from the Excel file.' },
  { icon: Settings, title: 'Server Processing', description: 'The backend receives the files and the selected sheet name.' },
  { icon: GitBranch, title: 'Load Mapping', description: 'Reads the mapping data from the specified Excel sheet.' },
  { icon: Terminal, title: 'Code Conversion', description: 'Parses the Python code line by line, applying mapping rules to convert Playwright commands to Robot Framework keywords and syntax.' },
  { icon: Terminal, title: 'Code Alignment', description: 'Formats the generated Robot code with proper indentation for readability.' },
  { icon: Download, title: 'Download Output', description: 'Packages the converted file(s) (.robot or .zip) for download.' },
  { icon: CheckCircle, title: 'Conversion Complete', description: 'The user receives the converted Robot Framework files.' },
];

export default function AboutDialog({ isOpen, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-card/80 dark:bg-card/70 backdrop-blur-md border-border/30 shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-primary flex items-center gap-2">
            <Info className="h-6 w-6" /> About the Converter
          </DialogTitle>
          <DialogDescription className="text-muted-foreground pt-2">
            This tool converts Playwright Python scripts into Robot Framework test cases using a custom mapping defined in an Excel file. Here's how it works:
          </DialogDescription>
        </DialogHeader>
        <div className="mt-6 overflow-x-auto pb-4">
          <div className="flex items-start space-x-4 min-w-max px-2">
            {steps.map((step, index) => (
              <React.Fragment key={index}>
                <motion.div
                  className="flex flex-col items-center text-center w-32"
                  custom={index}
                  initial="hidden"
                  animate={isOpen ? "visible" : "hidden"} // Animate only when dialog is open
                  variants={stepVariants}
                >
                  <div className="bg-primary/10 text-primary rounded-full p-3 mb-2 border border-primary/30">
                    <step.icon className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-semibold text-foreground mb-1">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </motion.div>

                {index < steps.length - 1 && (
                  <motion.svg
                    width="40"
                    height="24"
                    viewBox="0 0 40 24"
                    className="mt-5 shrink-0"
                    custom={index}
                    initial="hidden"
                    animate={isOpen ? "visible" : "hidden"} // Animate only when dialog is open
                    variants={arrowVariants}
                  >
                    <motion.line
                      x1="0"
                      y1="12"
                      x2="30"
                      y2="12"
                      stroke="hsl(var(--primary))"
                      strokeWidth="1.5"
                       variants={arrowVariants}
                    />
                    <motion.polyline
                      points="25,7 30,12 25,17"
                      stroke="hsl(var(--primary))"
                      strokeWidth="1.5"
                      fill="none"
                       variants={arrowVariants}
                    />
                  </motion.svg>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
         <div className="mt-4 p-4 bg-muted/20 rounded-md border border-border/20">
             <h4 className="text-sm font-semibold text-foreground mb-2">Conversion Logic Highlights:</h4>
             <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                 <li><span className="font-medium text-foreground/90">Mapping:</span> Uses an Excel sheet (`Actual_core_python_playwright_methods` to `browser_library_keyword`) for command translation.</li>
                 <li><span className="font-medium text-foreground/90">Locators:</span> Extracts and formats CSS selectors (e.g., `#id`, `name="value"`, `text=...`) for Robot Framework.</li>
                 <li><span className="font-medium text-foreground/90">Structure:</span> Generates standard Robot Framework sections (`*** Settings ***`, `*** Variables ***`, `*** Test Cases ***`).</li>
                 <li><span className="font-medium text-foreground/90">Assertions:</span> Converts `expect()` statements (visibility, text content) to corresponding Robot keywords (`Wait For Elements State`, `Get Text`).</li>
                 <li><span className="font-medium text-foreground/90">Setup/Teardown:</span> Automatically adds `New Browser`, `New Context`, `New Page` on the first `page.goto()` and `Close Context`, `Close Browser` on `context.close()` or at the end.</li>
                 <li><span className="font-medium text-foreground/90">Alignment:</span> Indents test steps within `*** Test Cases ***` using 4 spaces for proper Robot syntax.</li>
             </ul>
         </div>
      </DialogContent>
    </Dialog>
  );
}

// Import Info icon if not already imported elsewhere
import { Info } from 'lucide-react';
