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

// Government Logos
import moeLogo from "@assets/moe_logo.png";
import statathonLogo from "@assets/statathon_logo.png";
import innovationCellLogo from "@assets/innovation_cell_logo.png";
import airavataLogo from "@assets/airavata_logo.png";

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

  const mospiLogoUrl = "https://www.mospi.gov.in/uploads/primaryLogo/primaryLogo-1dee0dd9-99fd-4b8f-a352-7a53e0655404.svg";

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
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header with 4 Balanced Sections */}
      <header className="w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 py-4 px-8">
        <div className="flex items-center justify-between w-full gap-8">
          {/* Section 1: MoSPI */}
          <div className="flex-1 flex items-center justify-center gap-4 border-r pr-8">
            <img src={mospiLogoUrl} alt="MoSPI" className="h-16 w-auto object-contain" />
            <div className="flex flex-col">
              <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 leading-tight font-sans uppercase">GOVERNMENT OF INDIA</span>
              <span className="text-[14px] font-bold text-slate-900 dark:text-white leading-tight font-sans">Ministry of Statistics and</span>
              <span className="text-[14px] font-bold text-slate-900 dark:text-white leading-tight font-sans">Programme Implementation</span>
            </div>
          </div>

          {/* Section 2: Ministry of Education */}
          <div className="flex-1 flex items-center justify-center gap-4 border-r pr-8">
            <img src={moeLogo} alt="MoE" className="h-16 w-auto object-contain" />
            <div className="flex flex-col">
              <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 leading-tight font-sans uppercase">GOVERNMENT OF INDIA</span>
              <span className="text-[14px] font-bold text-slate-900 dark:text-white leading-tight font-sans">Ministry of Education</span>
            </div>
          </div>

          {/* Section 3: Innovation Cell */}
          <div className="flex-1 flex items-center justify-center gap-4 border-r pr-8">
            <img src={innovationCellLogo} alt="Innovation Cell" className="h-16 w-auto object-contain" />
          </div>

          {/* Section 4: Statathon */}
          <div className="flex-1 flex items-center justify-center">
            <img src={statathonLogo} alt="Statathon 2025" className="h-16 w-auto object-contain" />
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row h-full">
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white dark:bg-slate-900 -mt-24">
          <div className="w-full max-w-md space-y-8">
            <div className="text-center space-y-4">
              <div className="flex flex-col items-center justify-center gap-4">
                <img src={airavataLogo} alt="AIRAVATA" className="h-24 w-auto" />
                <span className="text-[36px] font-semibold tracking-widest text-slate-900 dark:text-white uppercase font-sans">AIRAVATA</span>
              </div>
            </div>
            
            <div className="bg-white dark:bg-slate-900 p-2">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                  <TabsTrigger 
                    value="login" 
                    data-testid="tab-login"
                    className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700 shadow-sm transition-all"
                  >
                    Login
                  </TabsTrigger>
                  <TabsTrigger 
                    value="register" 
                    data-testid="tab-register"
                    className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700 shadow-sm transition-all"
                  >
                    Register
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="login" className="mt-6">
                  <Form {...loginForm}>
                    <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-6">
                      <FormField
                        control={loginForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">Username</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="Enter your username" 
                                {...field} 
                                data-testid="input-login-username"
                                className="h-11"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={loginForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">Password</FormLabel>
                            <FormControl>
                              <Input 
                                type="password" 
                                placeholder="Enter your password" 
                                {...field}
                                data-testid="input-login-password"
                                className="h-11"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        className="w-full h-11 text-base font-semibold" 
                        disabled={loginMutation.isPending}
                        data-testid="button-login-submit"
                      >
                        {loginMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Signing in...
                          </>
                        ) : (
                          "Sign In"
                        )}
                      </Button>
                    </form>
                  </Form>
                </TabsContent>

                <TabsContent value="register" className="mt-6">
                  <Form {...registerForm}>
                    <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-6">
                      <FormField
                        control={registerForm.control}
                        name="fullName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">Full Name</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="Enter your full name" 
                                {...field}
                                data-testid="input-register-fullname"
                                className="h-11"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">Email</FormLabel>
                            <FormControl>
                              <Input 
                                type="email" 
                                placeholder="Enter your email" 
                                {...field}
                                data-testid="input-register-email"
                                className="h-11"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">Username</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="Choose a username" 
                                {...field}
                                data-testid="input-register-username"
                                className="h-11"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-semibold">Password</FormLabel>
                            <FormControl>
                              <Input 
                                type="password" 
                                placeholder="Create a password" 
                                {...field}
                                data-testid="input-register-password"
                                className="h-11"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        className="w-full h-11 text-base font-semibold" 
                        disabled={registerMutation.isPending}
                        data-testid="button-register-submit"
                      >
                        {registerMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Creating account...
                          </>
                        ) : (
                          "Create Account"
                        )}
                      </Button>
                    </form>
                  </Form>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>

        <div 
          className="hidden lg:flex flex-1 items-center justify-center p-12 relative bg-cover bg-center"
          style={{
            backgroundImage: `url(${backgroundImage})`,
          }}
        >
          <div 
            className="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-slate-900/40"
            style={{ zIndex: 1 }}
          />
          <div className="max-w-xl text-white relative z-10">
            <div className="flex items-center gap-4 mb-10">
              <Shield className="h-14 w-14 text-sky-400" />
              <div>
                <h1 className="text-4xl font-bold tracking-tight">SafeData Pipeline</h1>
                <p className="text-sky-100/80 text-lg">Government of India</p>
              </div>
            </div>
            
            <h2 className="text-3xl font-semibold mb-8 leading-tight">
              Enterprise-Grade Data Privacy & <br />Anonymization Infrastructure
            </h2>
            
            <div className="grid grid-cols-1 gap-6">
              {[
                { icon: Lock, title: "Advanced Anonymization", desc: "K-Anonymity, L-Diversity, T-Closeness, and Differential Privacy" },
                { icon: Database, title: "Risk Assessment", desc: "Comprehensive re-identification risk analysis and mitigation" },
                { icon: FileCheck, title: "Utility Preservation", desc: "Measure and maintain data utility after anonymization" },
                { icon: BarChart3, title: "Compliance Reporting", desc: "Generate executive, technical, and regulatory compliance reports" }
              ].map((item, idx) => (
                <div key={idx} className="flex items-start gap-5 p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
                  <div className="p-3 bg-sky-500/20 rounded-lg shrink-0">
                    <item.icon className="h-7 w-7 text-sky-300" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg mb-1">{item.title}</h3>
                    <p className="text-slate-200/90 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <p className="text-sm font-medium text-slate-300">
                  Ministry of Electronics and Information Technology
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Developed by AIRAVATA Technologies
                </p>
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-px bg-white/10 hidden sm:block" />
                <img src={airavataLogo} alt="GoI" className="h-10 opacity-70 grayscale invert" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
