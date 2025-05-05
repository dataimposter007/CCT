'use client';

import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bot, Send, X, Loader2 } from 'lucide-react';
import { handleChatMessage } from '@/app/actions'; // Import server action
import { cn } from '@/lib/utils';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'bot';
}

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollViewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
      if (scrollViewport) {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      }
    }
  }, [messages, isOpen]); // Add isOpen dependency to scroll when opened

  const handleSend = async () => {
    if (inputValue.trim() === '' || isLoading) return;

    const userMessage: Message = {
      id: Date.now(),
      text: inputValue,
      sender: 'user',
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const botResponseText = await handleChatMessage({ message: userMessage.text });
      const botMessage: Message = {
        id: Date.now() + 1,
        text: botResponseText,
        sender: 'bot',
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      console.error('Chatbot error:', error);
      const errorMessage: Message = {
        id: Date.now() + 1,
        text: 'Sorry, something went wrong. Please try again.',
        sender: 'bot',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      // Ensure input field is focused after sending
      setTimeout(() => {
         const inputElement = document.getElementById('chat-input');
         inputElement?.focus();
      }, 0);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent default form submission or newline
      handleSend();
    }
  };

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
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm break-words",
                    message.sender === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  {message.text}
                </div>
              </div>
            ))}
             {isLoading && (
               <div className="flex justify-start">
                 <div className="bg-muted text-foreground rounded-lg px-3 py-2 text-sm inline-flex items-center space-x-2">
                   <Loader2 className="w-4 h-4 animate-spin text-primary" />
                   <span>Thinking...</span>
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
              placeholder="Type your message..."
              className="flex-1 h-9 text-sm bg-background/50 dark:bg-background/30 focus:ring-1 focus:ring-primary"
              disabled={isLoading}
              autoComplete="off" // Prevent browser autocomplete
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={isLoading || inputValue.trim() === ''}
              className="h-9 w-9"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span className="sr-only">Send message</span>
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Add custom animation keyframes to globals.css if needed
// In src/app/globals.css:
/*
@keyframes pulse-scale {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.9;
  }
}

.animate-pulse-scale {
  animation: pulse-scale 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
*/
