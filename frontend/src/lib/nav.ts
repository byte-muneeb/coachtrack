// Sidebar navigation for CoachTrack Pro. Each item maps a Material Symbol
// icon to an App Router route. Grouped for readability in the sidebar.

export type NavItem = {
  label: string;
  href: string;
  icon: string; // Material Symbols Outlined ligature
};

export type NavGroup = {
  heading: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    heading: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", icon: "dashboard" }],
  },
  {
    heading: "Students",
    items: [
      { label: "Student Registry", href: "/students", icon: "group" },
      { label: "New Registration", href: "/students/register", icon: "person_add" },
      { label: "Import Data", href: "/import", icon: "upload_file" },
      { label: "Inquiries", href: "/admissions", icon: "how_to_reg" },
    ],
  },
  {
    heading: "Finance",
    items: [
      { label: "Fee Definition", href: "/fees", icon: "payments" },
      { label: "Vouchers & Collections", href: "/vouchers", icon: "receipt_long" },
      { label: "Fee Reminders", href: "/reminders", icon: "notifications_active" },
      { label: "Expenses & Profit", href: "/expenses", icon: "account_balance_wallet" },
    ],
  },
  {
    heading: "Academics",
    items: [
      { label: "Courses", href: "/courses", icon: "school" },
      { label: "Attendance", href: "/attendance", icon: "fact_check" },
      { label: "Tests & Results", href: "/tests", icon: "quiz" },
    ],
  },
  {
    heading: "Institution",
    items: [
      { label: "Branches", href: "/branches", icon: "apartment" },
      { label: "Reports", href: "/reports", icon: "analytics" },
      { label: "Users", href: "/users", icon: "manage_accounts" },
      { label: "Audit Log", href: "/audit", icon: "history" },
      { label: "Settings", href: "/settings", icon: "settings" },
    ],
  },
];
