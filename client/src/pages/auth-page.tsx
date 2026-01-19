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
    <div className="min-h-screen flex flex-col bg-background">
      <header className="relative z-50 w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 py-4 px-8">
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

      <div className="flex-1 flex flex-col lg:flex-row h-full">
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white dark:bg-slate-900">
          <div className="w-full max-w-md space-y-8">
            <div className="text-center space-y-4">
              <div className="flex flex-col items-center justify-center gap-4">
                <img src="/attached_assets/airavata_logo.png" alt="AIRAVATA" className="h-24 w-auto" />
                <span className="text-[36px] font-semibold tracking-widest text-slate-900 dark:text-white uppercase font-sans">AIRAVATA</span>
              </div>
            </div>
            
            <div className="bg-white dark:bg-slate-900 p-2">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                  <TabsTrigger value="login" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Login</TabsTrigger>
                  <TabsTrigger value="register" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Register</TabsTrigger>
                </TabsList>
                
                <TabsContent value="login" className="mt-6">
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

                <TabsContent value="register" className="mt-6">
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
              </Tabs>
            </div>
          </div>
        </div>

        <div className="hidden lg:flex flex-1 items-center justify-center p-12 relative bg-cover bg-center" style={{ backgroundImage: `url(${backgroundImage})` }}>
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-slate-900/40" style={{ zIndex: 1 }} />
          <div className="max-w-xl text-white relative z-10">
            <div className="flex items-center gap-4 mb-10">
              <Shield className="h-14 w-14 text-sky-400" />
              <div>
                <h1 className="text-4xl font-bold">SafeData Pipeline</h1>
                <p className="text-sky-100/80">Government of India</p>
              </div>
            </div>
            <h2 className="text-3xl font-semibold mb-8 leading-tight">Enterprise-Grade Data Privacy Anonymization Infrastructure</h2>
            <div className="grid grid-cols-1 gap-6">
              {[
                { icon: Lock, title: "Advanced Anonymization", desc: "K-Anonymity, L-Diversity, T-Closeness, and Differential Privacy" },
                { icon: Database, title: "Risk Assessment", desc: "Comprehensive re-identification risk analysis and mitigation" },
                { icon: FileCheck, title: "Utility Preservation", desc: "Measure and maintain data utility after anonymization" },
                { icon: BarChart3, title: "Compliance Reporting", desc: "Generate executive, technical, and regulatory compliance reports" }
              ].map((item, idx) => (
                <div key={idx} className="flex items-start gap-5 p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
                  <div className="p-3 bg-sky-500/20 rounded-lg shrink-0"><item.icon className="h-7 w-7 text-sky-300" /></div>
                  <div>
                    <h3 className="font-bold text-lg mb-1">{item.title}</h3>
                    <p className="text-slate-200/90">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
