import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  HelpCircle,
  BookOpen,
  Shield,
  Database,
  AlertTriangle,
  BarChart3,
  FileText,
  Settings,
  Upload,
  Mail,
  Phone,
  Globe,
} from "lucide-react";

const faqs = [
  {
    question: "What is K-Anonymity?",
    answer: "K-Anonymity is a privacy protection technique that ensures each record in a dataset is indistinguishable from at least k-1 other records based on a set of quasi-identifiers. This makes it difficult for attackers to identify specific individuals in the data.",
  },
  {
    question: "How does L-Diversity improve upon K-Anonymity?",
    answer: "While K-Anonymity protects against identity disclosure, L-Diversity adds protection against attribute disclosure by ensuring that each equivalence class has at least l distinct values for sensitive attributes. This prevents attackers from inferring sensitive information even if they identify an individual's group.",
  },
  {
    question: "What is the difference between Laplace and Gaussian mechanisms in Differential Privacy?",
    answer: "Both are noise-adding mechanisms. Laplace mechanism adds noise drawn from a Laplace distribution and is suitable for queries with bounded sensitivity. Gaussian mechanism adds Gaussian noise and provides (epsilon, delta)-differential privacy, offering a slightly relaxed privacy guarantee but with better composition properties for multiple queries.",
  },
  {
    question: "How do I choose the right epsilon value?",
    answer: "Epsilon (the privacy budget) represents the privacy-utility trade-off. Lower epsilon values (0.1-1.0) provide strong privacy but may significantly impact data utility. Higher values (5.0-10.0) preserve more utility but offer weaker privacy guarantees. For sensitive data like healthcare records, epsilon values between 0.1-1.0 are recommended.",
  },
  {
    question: "What is synthetic data generation?",
    answer: "Synthetic data generation creates new artificial records that maintain the statistical properties and relationships of the original data without containing actual individual records. This provides strong privacy protection while allowing the data to be used for analysis, testing, and machine learning model training.",
  },
  {
    question: "How is utility measured after anonymization?",
    answer: "Utility is measured through multiple metrics including: statistical similarity (mean, variance preservation), correlation preservation, distribution similarity (KS-test), information loss, and query accuracy. A good anonymization maintains high utility (>80%) while achieving the desired privacy level.",
  },
];

const guides = [
  {
    title: "Getting Started",
    icon: Upload,
    description: "Learn how to upload your first dataset and configure basic settings.",
    steps: [
      "Navigate to Data Upload from the sidebar",
      "Drag and drop your CSV, XLSX, or JSON file",
      "Review the automatic quality assessment",
      "Preview your data to ensure correct parsing",
    ],
  },
  {
    title: "Risk Assessment",
    icon: AlertTriangle,
    description: "Understand how to assess re-identification risks in your data.",
    steps: [
      "Select a dataset from the Risk Assessment page",
      "Choose quasi-identifiers (columns that could identify individuals)",
      "Select sensitive attributes to protect",
      "Configure K-anonymity threshold and attack scenarios",
      "Run the assessment and review results",
    ],
  },
  {
    title: "Applying Anonymization",
    icon: Shield,
    description: "Step-by-step guide to applying privacy enhancement techniques.",
    steps: [
      "Go to Privacy Enhancement page",
      "Select the technique based on your privacy requirements",
      "Configure the parameters (k-value, epsilon, etc.)",
      "Select columns to anonymize",
      "Apply the technique and download results",
    ],
  },
  {
    title: "Generating Reports",
    icon: FileText,
    description: "Create comprehensive reports for compliance and documentation.",
    steps: [
      "Navigate to Reports page",
      "Enter a title for your report",
      "Select report type (Executive, Technical, Comprehensive)",
      "Choose format (PDF or HTML)",
      "Link relevant assessments and measurements",
      "Generate and download the report",
    ],
  },
];

export default function HelpPage() {
  return (
    <DashboardLayout title="Help & Documentation" breadcrumbs={[{ label: "Help & Documentation" }]}>
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Documentation</CardTitle>
                  <CardDescription className="text-xs">
                    Comprehensive user guides
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-chart-1/10">
                  <HelpCircle className="h-5 w-5 text-chart-1" />
                </div>
                <div>
                  <CardTitle className="text-base">FAQs</CardTitle>
                  <CardDescription className="text-xs">
                    Common questions answered
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-chart-4/10">
                  <Mail className="h-5 w-5 text-chart-4" />
                </div>
                <div>
                  <CardTitle className="text-base">Support</CardTitle>
                  <CardDescription className="text-xs">
                    Contact technical support
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Quick Start Guides
              </CardTitle>
              <CardDescription>
                Step-by-step guides for common tasks
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {guides.map((guide, idx) => (
                <Accordion type="single" collapsible key={idx}>
                  <AccordionItem value={`guide-${idx}`} className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-muted">
                          <guide.icon className="h-4 w-4" />
                        </div>
                        <div className="text-left">
                          <p className="font-medium">{guide.title}</p>
                          <p className="text-xs text-muted-foreground font-normal">
                            {guide.description}
                          </p>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ol className="space-y-2 ml-12 mt-2">
                        {guide.steps.map((step, stepIdx) => (
                          <li key={stepIdx} className="flex items-start gap-2 text-sm">
                            <Badge variant="outline" className="shrink-0 mt-0.5">
                              {stepIdx + 1}
                            </Badge>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                Frequently Asked Questions
              </CardTitle>
              <CardDescription>
                Common questions about privacy techniques
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="space-y-2">
                {faqs.map((faq, idx) => (
                  <AccordionItem key={idx} value={`faq-${idx}`} className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline text-left text-sm">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Contact Support</CardTitle>
            <CardDescription>
              Get in touch with our technical support team
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30">
                <div className="p-3 rounded-full bg-primary/10">
                  <Mail className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Email Support</p>
                  <p className="text-sm text-muted-foreground">info@airavatatechnologies.com</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30">
                <div className="p-3 rounded-full bg-chart-1/10">
                  <Phone className="h-5 w-5 text-chart-1" />
                </div>
                <div>
                  <p className="text-sm font-medium">Phone Support</p>
                  <p className="text-sm text-muted-foreground">+91 9619523254</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30">
                <div className="p-3 rounded-full bg-chart-4/10">
                  <Globe className="h-5 w-5 text-chart-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Website</p>
                  <p className="text-sm text-muted-foreground">www.airavatatechnologies.com</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privacy Techniques Reference</CardTitle>
            <CardDescription>
              Quick reference for anonymization techniques and their parameters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="p-4 rounded-lg border">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <h4 className="font-semibold">K-Anonymity</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">K Value</span>
                    <span>2 - 20</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Suppression</span>
                    <span>0% - 20%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Methods</span>
                    <span>3 available</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg border">
                <div className="flex items-center gap-2 mb-3">
                  <Database className="h-5 w-5 text-chart-1" />
                  <h4 className="font-semibold">L-Diversity</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">L Value</span>
                    <span>2 - 10</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Types</span>
                    <span>Distinct, Entropy</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Use Case</span>
                    <span>Sensitive data</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg border">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-5 w-5 text-chart-3" />
                  <h4 className="font-semibold">Differential Privacy</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Epsilon</span>
                    <span>0.1 - 10.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mechanisms</span>
                    <span>Laplace, Gaussian</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Best For</span>
                    <span>Numeric data</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
