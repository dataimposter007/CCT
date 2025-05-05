'use client';

import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bot, Send, X, Loader2, Link as LinkIcon, MessageSquareWarning, Mail, HelpCircle } from 'lucide-react'; // Added icons
// Import the new server action
import { sendFeedbackEmail } from '@/app/actions';
import { useToast } from '@/hooks/use-toast'; // Import useToast
import { cn } from '@/lib/utils';

interface Message {
  id: number;
  text: string | React.ReactNode; // Allow ReactNode for links/buttons
  sender: 'user' | 'bot';
  showButtons?: boolean; // Flag to indicate if this message should show choice buttons
}

type ChatState = 'initial' | 'awaiting_choice' | 'awaiting_feedback' | 'processing_feedback' ; // Removed interaction_complete

const initialBotMessage: Message = {
    id: 0,
    sender: 'bot',
    text: "Hi there! How can I help you today? Please choose an option:",
    showButtons: true, // Show buttons with the initial message
};


// Component for Choice Buttons
interface ChoiceButtonsProps {
    onChoice: (choice: 'rf' | 'website' | 'feedback') => void;
    disabled: boolean;
}
const ChoiceButtons: React.FC<ChoiceButtonsProps> = ({ onChoice, disabled }) => {
    return (
        // Changed flex-row to flex-col and added sm:flex-row for responsiveness
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
            <Button
                variant="outline"
                size="sm"
                className="justify-start text-left h-auto py-1.5 px-3 bg-background/60 hover:bg-primary/10 hover:border-primary/50 border border-border/30 disabled:opacity-50"
                onClick={() => onChoice('rf')}
                disabled={disabled}
            >
                <HelpCircle className="w-4 h-4 mr-2 text-primary/80" />
                Robot Framework queries
            </Button>
            <Button
                variant="outline"
                size="sm"
                className="justify-start text-left h-auto py-1.5 px-3 bg-background/60 hover:bg-primary/10 hover:border-primary/50 border border-border/30 disabled:opacity-50"
                onClick={() => onChoice('website')}
                disabled={disabled}
            >
                <MessageSquareWarning className="w-4 h-4 mr-2 text-primary/80" />
                Website related issues
            </Button>
            <Button
                variant="outline"
                size="sm"
                className="justify-start text-left h-auto py-1.5 px-3 bg-background/60 hover:bg-primary/10 hover:border-primary/50 border border-border/30 disabled:opacity-50"
                onClick={() => onChoice('feedback')}
                disabled={disabled}
            >
                <Mail className="w-4 h-4 mr-2 text-primary/80" />
                Suggest new updates/feedback
            </Button>
        </div>
    );
};


export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [chatState, setChatState] = useState<ChatState>('initial');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Initialize chat when opened
  useEffect(() => {
    if (isOpen && chatState === 'initial') {
      setMessages([initialBotMessage]);
      setChatState('awaiting_choice');
    } else if (!isOpen) {
      // Reset state when closed
      setMessages([]);
      setInputValue('');
      setChatState('initial');
      setIsLoading(false);
    }
  }, [isOpen, chatState]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      requestAnimationFrame(() => {
        const scrollViewport = scrollAreaRef.current?.querySelector('div[data-radix-scroll-area-viewport]');
        if (scrollViewport) {
          scrollViewport.scrollTop = scrollViewport.scrollHeight;
        }
      });
    }
  }, [messages]);


  const addMessage = (sender: 'user' | 'bot', text: string | React.ReactNode, showButtons = false) => {
      // Remove buttons from previous messages before adding a new one
      setMessages((prev) => prev.map(msg => ({ ...msg, showButtons: false })));
      // Add the new message
      setMessages((prev) => [...prev, { id: Date.now() + Math.random(), sender, text, showButtons }]);
  };

  // Handle button choice clicks
  const handleChoice = async (choice: 'rf' | 'website' | 'feedback') => {
    if (isLoading) return;

    let userMessageText = '';
    switch (choice) {
        case 'rf': userMessageText = 'Robot Framework queries'; break;
        case 'website': userMessageText = 'Website related issues'; break;
        case 'feedback': userMessageText = 'Suggest new updates/feedback'; break;
    }

    addMessage('user', userMessageText);
    setIsLoading(true);

    // Simulate bot thinking time
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
        if (choice === 'rf') {
            addMessage('bot', (
              <>
                For Robot Framework Browser library documentation, please visit:
                <a
                  href="https://marketsquare.github.io/robotframework-browser/Browser.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary/80 ml-1 inline-flex items-center"
                >
                  Browser Library Docs <LinkIcon className="h-3 w-3 ml-1" />
                </a>
                <p className="mt-2">Is there anything else I can help with?</p>
              </>
            ), true); // Show buttons again
            setChatState('awaiting_choice');
        } else if (choice === 'website') {
            addMessage('bot', 'Sure, we will look into the website issue and get back to you soon. Thanks for reporting!\nIs there anything else I can help with?', true); // Show buttons again
            setChatState('awaiting_choice');
        } else if (choice === 'feedback') {
            addMessage('bot', 'Great! Please type your feedback or suggestion below.');
            setChatState('awaiting_feedback');
        }
    } catch (error) {
        console.error('Chatbot choice processing error:', error);
        addMessage('bot', 'Sorry, an unexpected error occurred. How else can I help?', true); // Show buttons on error
        setChatState('awaiting_choice');
        toast({
           title: "Chat Error",
           description: "An unexpected error occurred processing your choice.",
           variant: "destructive",
       });
    } finally {
        setIsLoading(false);
        // Keep focus management logic if needed
    }
  };


  // Handle text input submission (primarily for feedback now)
  const handleSend = async () => {
    const trimmedInput = inputValue.trim();
    // Only allow sending in feedback state
    if (trimmedInput === '' || isLoading || chatState !== 'awaiting_feedback') return;

    addMessage('user', trimmedInput);
    setInputValue('');
    setIsLoading(true);
    setChatState('processing_feedback'); // Move to processing state

    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
        const feedbackResult = await sendFeedbackEmail(trimmedInput);

        if (feedbackResult.success) {
            addMessage('bot', 'Thank you for your feedback! We have received it.\nIs there anything else I can help with?', true); // Show buttons again
            toast({
                title: "Feedback Sent",
                description: "Your feedback has been recorded.",
                variant: "default",
            });
        } else {
            addMessage('bot', `Sorry, there was an error sending your feedback${feedbackResult.error ? ': ' + feedbackResult.error : '.'}. Please try again later.\nIs there anything else I can help with?`, true); // Show buttons again
            toast({
                title: "Feedback Error",
                description: feedbackResult.error || "Could not send feedback.",
                variant: "destructive",
            });
        }
        setChatState('awaiting_choice'); // Loop back to choices after feedback attempt
    } catch (error) {
      console.error('Chatbot feedback processing error:', error);
      addMessage('bot', 'Sorry, an unexpected error occurred while sending feedback. How else can I help?', true); // Show buttons on error
      setChatState('awaiting_choice');
       toast({
           title: "Feedback Error",
           description: "An unexpected error occurred sending your feedback.",
           variant: "destructive",
       });
    } finally {
        setIsLoading(false);
        // Refocus input after feedback attempt if needed
        setTimeout(() => {
            const inputElement = document.getElementById('chat-input');
            inputElement?.focus();
        }, 0);
    }
  };


  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // Only trigger send if in feedback state
      if (chatState === 'awaiting_feedback') {
        handleSend();
      }
    }
  };

  // Input is disabled if loading OR if the bot is waiting for a button choice
  const isInputDisabled = isLoading || chatState === 'awaiting_choice' || chatState === 'processing_feedback';

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          className="fixed bottom-6 right-6 rounded-full w-16 h-16 p-0 shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground focus:ring-2 focus:ring-primary focus:ring-offset-2 animate-pulse-scale"
          aria-label="Open Chatbot"
        >
          <Bot className="w-8 h-8" />
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping"></span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 sm:w-96 h-[30rem] sm:h-[32rem] p-0 flex flex-col border-border/30 shadow-2xl mr-2 mb-2 rounded-xl bg-card/80 dark:bg-card/70 backdrop-blur-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
            e.preventDefault();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border/20 bg-muted/30 rounded-t-xl">
          <div className="flex items-center space-x-2">
            <Bot className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Support Chat</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="h-7 w-7">
            <X className="w-4 h-4 text-muted-foreground" />
            <span className="sr-only">Close chat</span>
          </Button>
        </div>

        {/* Messages Area */}
        <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex flex-col", // Use flex-col to stack message and buttons
                  message.sender === 'user' ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm break-words shadow-sm",
                    message.sender === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground border border-border/10"
                  )}
                >
                  {message.text}
                </div>
                 {/* Render buttons if the flag is set */}
                {message.sender === 'bot' && message.showButtons && (
                    <ChoiceButtons onChoice={handleChoice} disabled={isLoading} />
                )}
              </div>
            ))}
             {isLoading && chatState !== 'processing_feedback' && (
               <div className="flex justify-start">
                 <div className="bg-muted text-foreground rounded-lg px-3 py-2 text-sm inline-flex items-center space-x-2 border border-border/10 shadow-sm">
                   <Loader2 className="w-4 h-4 animate-spin text-primary" />
                   <span>Thinking...</span>
                 </div>
               </div>
             )}
             {chatState === 'processing_feedback' && (
                <div className="flex justify-start">
                    <div className="bg-muted text-foreground rounded-lg px-3 py-2 text-sm inline-flex items-center space-x-2 border border-border/10 shadow-sm">
                        <Mail className="w-4 h-4 animate-pulse text-primary" />
                        <span>Sending feedback...</span>
                    </div>
                </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-3 border-t border-border/20">
          <div className="flex items-center space-x-2">
            <Input
              id="chat-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                  chatState === 'awaiting_feedback' ? "Type your feedback here..." :
                  chatState === 'processing_feedback' ? "Processing..." :
                  chatState === 'awaiting_choice' ? "Please select an option above" : // Updated placeholder
                   "Select an option or type feedback..." // Fallback
               }
              className="flex-1 h-9 text-sm bg-background/50 dark:bg-background/30 focus:ring-1 focus:ring-primary"
              disabled={isInputDisabled} // Disable based on state
              autoComplete="off"
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              // Only enable send button when in feedback state and not loading/processing
              disabled={isLoading || chatState !== 'awaiting_feedback' || inputValue.trim() === ''}
              className="h-9 w-9"
              aria-label={isLoading ? "Sending..." : "Send message"}
            >
              {isLoading && chatState === 'processing_feedback' ? ( // Show loader specifically for feedback processing
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
           {/* Removed chat end message */}
        </div>
      </PopoverContent>
    </Popover>
  );
}
