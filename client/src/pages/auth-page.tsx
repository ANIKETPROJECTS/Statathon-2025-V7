import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
type LoginFormData = z.infer<typeof loginSchema>;

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { user, loginMutation } = useAuth();

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  if (user) {
    const role = user.role;
    if (role === "researcher") setLocation("/researcher");
    else setLocation("/");
    return null;
  }

  const onLogin = (data: LoginFormData) => loginMutation.mutate(data);

  return (
    <div className="h-screen flex flex-col bg-background relative overflow-hidden">
      {/* ── Top header bar ── */}
      <header className="relative z-50 w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 py-4 px-8 shrink-0">
        <div className="flex items-center justify-between w-full gap-8 overflow-visible">
          <div className="flex-1 flex items-center justify-center gap-4 border-r pr-8 overflow-visible">
            <img src="/attached_assets/Government_of_India_logo.svg" alt="Government of India" className="h-20 w-auto object-contain" />
          </div>
          <div className="flex-1 flex items-center justify-center gap-4 border-r pr-8 overflow-visible">
            <img src="/attached_assets/Ministry_of_Education_India.svg" alt="Ministry of Education" className="h-20 w-auto object-contain" />
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
        {/* ── Right: Login form ── */}
        <div className="flex-1 flex flex-col items-center justify-start pt-8 p-8 bg-white dark:bg-slate-900 overflow-visible lg:border-l lg:border-slate-200 lg:dark:border-slate-800 relative">
          <div className="absolute top-4 right-4 flex flex-col items-end text-right">
            <img src="/sih-logo.png" alt="SIH 2024" className="h-16 w-auto object-contain mb-1.5" />
            <span className="text-base font-bold text-slate-500 dark:text-slate-400">SIH1693</span>
            <span className="text-sm font-bold text-black uppercase tracking-tight">SIH 2024 WINNER</span>
          </div>

          <div className="w-full max-w-md space-y-0">
            <div className="text-center space-y-0">
              <div className="flex flex-col items-center justify-center">
                <img src="/attached_assets/airavata_logo_large.png" alt="AIRAVATA" className="h-[240px] w-auto object-contain" data-testid="img-airavata-logo" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-2">
              <div className="mb-6">
                <div className="w-full bg-slate-100 dark:bg-slate-800 p-1 rounded-lg flex">
                  <div className="flex-1 py-1.5 text-center text-sm font-medium bg-white dark:bg-slate-700 rounded-md shadow-sm text-slate-900 dark:text-white">
                    Login
                  </div>
                </div>
              </div>

              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-6">
                  <FormField
                    control={loginForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl><Input placeholder="Username" data-testid="input-username" {...field} /></FormControl>
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
                        <FormControl><Input type="password" placeholder="Password" data-testid="input-password" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-11" disabled={loginMutation.isPending} data-testid="button-sign-in">
                    {loginMutation.isPending ? <Loader2 className="animate-spin" /> : "Sign In"}
                  </Button>
                </form>
              </Form>
            </div>
          </div>
        </div>

        {/* ── Left: Branding panel ── */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-12 bg-white dark:bg-slate-900">
          <div className="max-w-2xl text-slate-900 dark:text-white w-full">
            <div className="flex flex-col items-center text-center mb-12">
              <img src="/attached_assets/mospi_logo_large.png" alt="MoSPI Government of India" className="h-32 w-auto object-contain mb-12" />
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
        <div className="flex items-center justify-center space-x-2 text-xs md:text-sm text-black px-4">
          <span className="font-medium whitespace-nowrap">
            Developed by <a href="https://www.airavatatechnologies.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 font-bold hover:underline">AIRAVATA TECHNOLOGIES</a>
          </span>
          <span className="text-black font-bold">|</span>
          <a href="https://www.airavatatechnologies.com/" target="_blank" rel="noopener noreferrer" className="text-black hover:text-blue-600 transition-colors underline underline-offset-4 whitespace-nowrap font-medium">
            www.airavatatechnologies.com
          </a>
          <span className="text-black font-bold">|</span>
          <a href="mailto:info@airavatatechnologies.com" className="text-black hover:text-blue-600 transition-colors underline underline-offset-4 whitespace-nowrap font-medium">
            info@airavatatechnologies.com
          </a>
        </div>
      </footer>
    </div>
  );
}
