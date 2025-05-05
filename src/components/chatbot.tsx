'use client';

import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bot, Send, X, Loader2, Link as LinkIcon, MessageSquareWarning, Mail } from 'lucide-react'; // Added icons
// Import the new server action
import { sendFeedbackEmail } from '@/app/actions';
import { useToast } from '@/hooks/use-toast'; // Import useToast
import { cn } from '@/lib/utils';

interface Message {
  id: number;
  text: string | React.ReactNode; // Allow ReactNode for links
  sender: 'user' | 'bot';
}

type ChatState = 'initial' | 'awaiting_choice' | 'awaiting_feedback' | 'processing_feedback' | 'interaction_complete';

const initialBotMessage: Message = {
    id: 0,
    sender: 'bot',
    text: (
        <>
            <p className="mb-2">Hi there! How can I help you today? Please choose an option:</p>
            <ol className="list-decimal list-inside space-y-1">
                <li>Robot Framework related queries</li>
                <li>Website related issues</li>
                <li>Suggest new updates/feedback</li>
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">Type the number (1, 2, or 3).</p>
        </>
    ),
};


export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [chatState, setChatState] = useState<ChatState>('initial');
  const [isLoading, setIsLoading] = useState(false); // Renamed from processing to isLoading for consistency
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast(); // Initialize useToast

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
      // Use requestAnimationFrame to ensure the DOM is updated
      requestAnimationFrame(() => {
        const scrollViewport = scrollAreaRef.current?.querySelector('div[data-radix-scroll-area-viewport]');
        if (scrollViewport) {
          scrollViewport.scrollTop = scrollViewport.scrollHeight;
        }
      });
    }
  }, [messages]); // Dependency on messages


  const addMessage = (sender: 'user' | 'bot', text: string | React.ReactNode) => {
      setMessages((prev) => [...prev, { id: Date.now() + Math.random(), sender, text }]);
  };

  const handleSend = async () => {
    const trimmedInput = inputValue.trim();
    if (trimmedInput === '' || isLoading) return;

    // Add user message
    addMessage('user', trimmedInput);
    setInputValue(''); // Clear input immediately

    setIsLoading(true); // Indicate processing starts

    // Simulate bot thinking time
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
        if (chatState === 'awaiting_choice') {
            if (trimmedInput === '1') {
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
                  </>
                ));
                setChatState('interaction_complete');
            } else if (trimmedInput === '2') {
                addMessage('bot', 'Sure, we will look into the website issue and get back to you soon. Thanks for reporting!');
                setChatState('interaction_complete');
            } else if (trimmedInput === '3') {
                addMessage('bot', 'Great! Please type your feedback or suggestion below.');
                setChatState('awaiting_feedback');
            } else {
                addMessage('bot', 'Invalid choice. Please type 1, 2, or 3.');
                // Keep state as 'awaiting_choice'
            }
        } else if (chatState === 'awaiting_feedback') {
             setChatState('processing_feedback'); // Move to processing state
             const feedbackResult = await sendFeedbackEmail(trimmedInput);

            if (feedbackResult.success) {
                addMessage('bot', 'Thank you for your feedback! We have received it.');
                toast({ // Add toast notification on success
                    title: "Feedback Sent",
                    description: "Your feedback has been recorded.",
                    variant: "default",
                });
            } else {
                addMessage('bot', `Sorry, there was an error sending your feedback${feedbackResult.error ? ': ' + feedbackResult.error : '.'}. Please try again later.`);
                toast({ // Add toast notification on failure
                    title: "Feedback Error",
                    description: feedbackResult.error || "Could not send feedback.",
                    variant: "destructive",
                });
            }
            setChatState('interaction_complete');
        }
    } catch (error) {
      console.error('Chatbot processing error:', error);
      addMessage('bot', 'Sorry, an unexpected error occurred.');
      setChatState('interaction_complete'); // End interaction on unexpected error
       toast({
           title: "Chat Error",
           description: "An unexpected error occurred in the chat.",
           variant: "destructive",
       });
    } finally {
        setIsLoading(false); // Indicate processing finished
         // Ensure input field is focused after sending/processing
        setTimeout(() => {
            const inputElement = document.getElementById('chat-input');
            inputElement?.focus();
        }, 0);
    }
  };


  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent default form submission or newline
      if (chatState !== 'interaction_complete' && chatState !== 'processing_feedback') { // Allow sending unless complete or processing
        handleSend();
      }
    }
  };

  const isInputDisabled = isLoading || chatState === 'interaction_complete' || chatState === 'processing_feedback';

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          className="fixed bottom-6 right-6 rounded-full w-16 h-16 p-0 shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground focus:ring-2 focus:ring-primary focus:ring-offset-2 animate-pulse-scale"
          aria-label="Open Chatbot"
        >
          <Bot className="w-8 h-8" />
          {/* Pulsing effect */}
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping"></span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 sm:w-96 h-[30rem] sm:h-[32rem] p-0 flex flex-col border-border/30 shadow-2xl mr-2 mb-2 rounded-xl bg-card/80 dark:bg-card/70 backdrop-blur-md"
        onOpenAutoFocus={(e) => e.preventDefault()} // Prevent Popover stealing focus
        onCloseAutoFocus={(e) => {
           // Prevent Popover returning focus to trigger on close
            e.preventDefault();
            // Optionally focus another element if needed, e.g., document.body
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
                  "flex",
                  message.sender === 'user' ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm break-words shadow-sm",
                    message.sender === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground border border-border/10" // Add subtle border to bot messages
                  )}
                >
                  {message.text}
                </div>
              </div>
            ))}
             {isLoading && chatState !== 'processing_feedback' && ( // Show thinking only when not sending feedback
               <div className="flex justify-start">
                 <div className="bg-muted text-foreground rounded-lg px-3 py-2 text-sm inline-flex items-center space-x-2 border border-border/10 shadow-sm">
                   <Loader2 className="w-4 h-4 animate-spin text-primary" />
                   <span>Thinking...</span>
                 </div>
               </div>
             )}
             {chatState === 'processing_feedback' && ( // Specific indicator for sending feedback
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
              id="chat-input" // Add ID for focusing
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                  chatState === 'awaiting_feedback' ? "Type your feedback here..." :
                  chatState === 'interaction_complete' ? "Chat ended. Re-open to start again." :
                  chatState === 'processing_feedback' ? "Processing..." :
                  chatState === 'awaiting_choice' ? "Type 1, 2, or 3..." :
                   "Type your message..." // Fallback/initial state
               }
              className="flex-1 h-9 text-sm bg-background/50 dark:bg-background/30 focus:ring-1 focus:ring-primary"
              disabled={isInputDisabled}
              autoComplete="off" // Prevent browser autocomplete
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={isInputDisabled || inputValue.trim() === ''}
              className="h-9 w-9"
              aria-label={isLoading ? "Sending..." : "Send message"}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
           {chatState === 'interaction_complete' && (
               <p className="text-xs text-center text-muted-foreground mt-2">Chat session ended. Please close and reopen the chat to start a new session.</p>
           )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
