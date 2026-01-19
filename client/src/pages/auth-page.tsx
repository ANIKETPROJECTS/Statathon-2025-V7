import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Lock, Database, FileCheck, BarChart3, Loader2 } from "lucide-react";
import backgroundImage from "@assets/background.jpg";
const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  email: z.string().email("Invalid email address"),
  fullName: z.string().min(2, "Full name is required"),
  role: z.enum(["admin", "analyst", "officer"]).default("analyst"),
  department: z.string().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;
type RegisterFormData = z.infer<typeof registerSchema>;

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { user, loginMutation, registerMutation } = useAuth();
  const [activeTab, setActiveTab] = useState("login");

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { 
      username: "", 
      password: "", 
      email: "", 
      fullName: "",
      role: "analyst",
      department: "",
    },
  });

  if (user) {
    setLocation("/");
    return null;
  }

  const onLogin = (data: LoginFormData) => {
    loginMutation.mutate(data);
  };

  const onRegister = (data: RegisterFormData) => {
    registerMutation.mutate(data);
  };

  return (
    <div className="h-screen flex flex-col bg-background relative overflow-hidden">
      <header className="relative z-50 w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 py-4 px-8 shrink-0">
        <div className="flex items-center justify-between w-full gap-8 overflow-visible">
          <div className="flex-1 flex items-center justify-center gap-4 border-r pr-8 overflow-visible">
            <img src="/attached_assets/Government_of_India_logo.svg" alt="Government of India" className="h-20 w-auto object-contain" style={{ display: 'block' }} />
          </div>

          <div className="flex-1 flex items-center justify-center gap-4 border-r pr-8 overflow-visible">
            <img src="/attached_assets/Ministry_of_Education_India.svg" alt="Ministry of Education" className="h-20 w-auto object-contain" style={{ display: 'block' }} />
          </div>

          <div className="flex-1 flex items-center justify-center gap-4 border-r pr-8 overflow-visible">
            <img src="/attached_assets/innovation_cell_logo.png" alt="Innovation Cell" className="h-20 w-auto object-contain min-w-[140px]" />
          </div>

          <div className="flex-1 flex items-center justify-center overflow-visible">
            <img src="/attached_assets/statathon_logo.png" alt="Statathon 2025" className="h-20 w-auto object-contain min-w-[180px]" />
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row-reverse h-full overflow-y-auto">
        <div className="flex-1 flex flex-col items-center justify-start pt-8 p-8 bg-white dark:bg-slate-900 overflow-visible lg:border-l lg:border-slate-200 lg:dark:border-slate-800">
          <div className="w-full max-w-md space-y-0">
            <div className="text-center space-y-0">
              <div className="flex flex-col items-center justify-center">
                <img 
                  src="/attached_assets/airavata_logo_large.png" 
                  alt="AIRAVATA" 
                  className="h-[200px] w-auto object-contain" 
                  data-testid="img-airavata-logo"
                />
              </div>
            </div>
            
            <div className="bg-white dark:bg-slate-900 p-2 min-h-[380px]">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                <TabsList className="grid w-full grid-cols-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg shrink-0">
                  <TabsTrigger value="login" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Login</TabsTrigger>
                  <TabsTrigger value="register" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Register</TabsTrigger>
                </TabsList>
                
                <div className="flex-1 relative">
                  <TabsContent value="login" className="mt-6 absolute inset-x-0 top-0 data-[state=inactive]:hidden">
                    <Form {...loginForm}>
                      <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-6">
                        <FormField
                          control={loginForm.control}
                          name="username"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Username</FormLabel>
                              <FormControl><Input placeholder="Username" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={loginForm.control}
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Password</FormLabel>
                              <FormControl><Input type="password" placeholder="Password" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" className="w-full h-11" disabled={loginMutation.isPending}>
                          {loginMutation.isPending ? <Loader2 className="animate-spin" /> : "Sign In"}
                        </Button>
                      </form>
                    </Form>
                  </TabsContent>

                  <TabsContent value="register" className="mt-6 absolute inset-x-0 top-0 data-[state=inactive]:hidden">
                    <Form {...registerForm}>
                      <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-6">
                        <FormField
                          control={registerForm.control}
                          name="fullName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Full Name</FormLabel>
                              <FormControl><Input placeholder="Full Name" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registerForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl><Input type="email" placeholder="Email" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registerForm.control}
                          name="username"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Username</FormLabel>
                              <FormControl><Input placeholder="Username" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registerForm.control}
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Password</FormLabel>
                              <FormControl><Input type="password" placeholder="Password" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" className="w-full h-11" disabled={registerMutation.isPending}>
                          {registerMutation.isPending ? <Loader2 className="animate-spin" /> : "Create Account"}
                        </Button>
                      </form>
                    </Form>
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </div>
        </div>

        <div className="hidden lg:flex flex-1 items-center justify-center p-12 bg-white dark:bg-slate-900">
          <div className="max-w-2xl text-slate-900 dark:text-white w-full">
            <div className="flex flex-col items-center text-center mb-12">
              <img 
                src="/attached_assets/mospi_logo_large.png" 
                alt="MoSPI Government of India" 
                className="h-32 w-auto object-contain mb-12" 
              />
              <div className="space-y-6 w-full">
                <div className="p-8 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  <div className="grid grid-cols-1 gap-6 text-left">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
                      <span className="text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider text-xs">Team Name</span>
                      <span className="text-2xl font-bold text-slate-900 dark:text-white">AIRAVATA</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
                      <span className="text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider text-xs">Team ID</span>
                      <span className="text-2xl font-bold text-slate-900 dark:text-white">4208</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
                      <span className="text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider text-xs">Problem Statement ID</span>
                      <span className="text-2xl font-bold text-slate-900 dark:text-white">1</span>
                    </div>
                    <div className="pt-2">
                      <span className="text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider text-xs block mb-3">Problem Statement Title</span>
                      <p className="text-xl font-semibold leading-relaxed text-slate-900 dark:text-white">
                        Evaluation of Effectiveness of Data Encryption and Anonymisation Adopted for Unit-level Data of NSS and Creation of an improved Safe Data Tool
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="w-full py-2 text-center border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 z-50">
        <div className="flex items-center justify-center space-x-2 text-[10px] md:text-xs text-slate-500 dark:text-slate-400 px-4">
          <span className="font-medium whitespace-nowrap">
            Developed by <span className="text-slate-900 dark:text-white font-bold">AIRAVATA TECHNOLOGIES</span>
          </span>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <a 
            href="https://www.airavatatechnologies.com/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors underline underline-offset-4 whitespace-nowrap"
          >
            www.airavatatechnologies.com
          </a>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <a 
            href="mailto:info@airavatatechnologies.com" 
            className="hover:text-primary transition-colors underline underline-offset-4 whitespace-nowrap"
          >
            info@airavatatechnologies.com
          </a>
        </div>
      </footer>
    </div>
  );
}
