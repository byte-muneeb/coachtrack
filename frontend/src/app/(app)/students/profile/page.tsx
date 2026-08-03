// Auto-generated from the Stitch design. Faithful static render; interactivity/data is wired in the DB phase.
export default function Page() {
  return (
    <div dangerouslySetInnerHTML={{ __html: `<main class="ml-[280px] min-h-screen">
<!-- TopNavBar (Shared Component Shell Logic) -->
<header class="fixed top-0 right-0 w-[calc(100%-280px)] h-16 bg-surface border-b border-outline-variant flex justify-between items-center px-margin-desktop z-40">
<div class="flex items-center flex-1 max-w-xl">
<div class="relative w-full">
<span class="material-symbols-outlined absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
<input class="w-full pl-xl pr-md py-xs bg-surface-container border border-outline-variant rounded-full text-body-md focus:ring-2 focus:ring-secondary focus:border-transparent outline-none" placeholder="Search students, courses or invoices..." type="text">
</div>
</div>
<div class="flex items-center gap-lg">
<button class="relative text-on-surface-variant hover:text-secondary transition-colors">
<span class="material-symbols-outlined">notifications</span>
<span class="absolute -top-1 -right-1 w-2 h-2 bg-error rounded-full"></span>
</button>
<button class="text-on-surface-variant hover:text-secondary transition-colors">
<span class="material-symbols-outlined">help_outline</span>
</button>
<div class="flex items-center gap-md border-l border-outline-variant pl-lg">
<div class="text-right">
<p class="font-label-md font-bold text-primary">Admin User</p>
<p class="text-[10px] text-on-surface-variant">System Registrar</p>
</div>
<div class="w-8 h-8 rounded-full overflow-hidden border border-outline-variant">
<img class="w-full h-full object-cover" data-alt="A professional headshot of a corporate administrator in a bright, modern office setting. The person is smiling confidently, wearing a crisp white shirt and navy blazer. The background is a softly blurred architectural space with neutral tones and plenty of natural daylight, matching the light-mode corporate aesthetic." src="https://lh3.googleusercontent.com/aida-public/AB6AXuAUMs8XGd7RbjrQ3fBdQKsT0lIRsL5W_UjASJdNgXAjKDeyfJtXvQ9Ft-HiRLURzITQNF_lZB1RP59EGQhgoiL_zM0IgMG_J_DVremV0II-oAsSnc4D-aWbKzaf0-Li4POJiI82H81KwPCmN2PZAcpt6Iew21x2gSHIngC2kwxqNyQIAzn3Oz5ac8GH7GIbCIgDIR9qVqcLtEHvXtyaFjQogKi3yn3ZCLG2bIc5uB3CH9KI_GRvs86g">
</div>
</div>
</div>
</header>
<!-- Page Content -->
<div class="pt-24 pb-xl px-margin-desktop">
<!-- Breadcrumbs -->
<nav class="flex items-center gap-xs text-on-surface-variant mb-lg">
<a class="text-secondary hover:underline" href="#">Student Registry</a>
<span class="material-symbols-outlined text-[16px]">chevron_right</span>
<span class="font-bold text-primary">Student Profile</span>
</nav>
<!-- Header Section -->
<section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-lg mb-lg">
<div class="flex items-center gap-lg">
<div class="w-24 h-24 rounded-full border-4 border-surface-container-high overflow-hidden shadow-sm">
<img class="w-full h-full object-cover" data-alt="A professional, clean studio portrait of a young man with a friendly expression. He has short dark hair and is wearing a simple gray crewneck sweater. The lighting is soft and even, set against a pristine, minimalist light gray background that emphasizes a modern, high-end educational management suite aesthetic." src="https://lh3.googleusercontent.com/aida-public/AB6AXuDRBdW9kZf4uJATX2J1QkoftZqb00aUW4FR9T_o92l6Lo4o1NHpbvniLo5XNzGPfMkTKhi3FqbC7wrgclGeytK3m5vhckagoqkJpN_1hdEsJtDRfqHYJK9xrQOY6I6CwmRlbOjyNNCcL7IVv2B9IMAptsujq6yGnmzhnc6pyoRqKjL7QxeIy3btEgDkW1Go3BEStm6R-dnIK8wspJMO-kPONs6XmB89imVV-IjcpH7kQlKJ1NxIy4TI">
</div>
<div>
<div class="flex items-center gap-md mb-xs">
<h2 class="font-display text-[26px] font-bold tracking-tight text-primary">Arjun Mehta</h2>
<span class="px-md py-xs bg-green-100 text-green-700 text-[10px] font-bold rounded-full uppercase tracking-wider">Active</span>
</div>
<p class="font-mono-data text-on-surface-variant">Registry ID: <span class="font-bold text-primary">CTP-2024-0892</span></p>
<p class="text-body-md text-on-surface-variant mt-xs">Enrolled since Sep 2023 • 4th Term</p>
</div>
</div>
<div class="flex flex-wrap gap-md">
<button class="flex items-center gap-sm px-lg py-sm border border-outline-variant rounded-lg font-bold text-primary hover:bg-surface-container-low transition-all active:scale-95">
<span class="material-symbols-outlined text-[20px]">edit</span>
<span class="">Edit Profile</span>
</button>
<button class="flex items-center gap-sm px-lg py-sm border border-outline-variant rounded-lg font-bold text-primary hover:bg-surface-container-low transition-all active:scale-95">
<span class="material-symbols-outlined text-[20px]">print</span>
<span class="">Print Report</span>
</button>
<button class="flex items-center gap-sm px-lg py-sm bg-secondary text-on-secondary rounded-lg font-bold shadow-sm hover:opacity-90 transition-all active:scale-95">
<span class="material-symbols-outlined text-[20px]">add_card</span>
<span class="">Generate Voucher</span>
</button>
</div>
</section>
<!-- Key Metrics Grid -->
<section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-lg mb-xl">
<div class="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl">
<div class="flex items-center justify-between mb-sm">
<span class="text-on-surface-variant font-label-md">Attendance %</span>
<span class="material-symbols-outlined text-secondary">event_available</span>
</div>
<h3 class="font-display text-display text-primary">94.2%</h3>
<div class="w-full h-1 bg-surface-container-high rounded-full mt-md overflow-hidden">
<div class="h-full bg-secondary w-[94.2%]"></div>
</div>
</div>
<div class="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl">
<div class="flex items-center justify-between mb-sm">
<span class="text-on-surface-variant font-label-md">Overall Grade</span>
<span class="material-symbols-outlined text-secondary">grade</span>
</div>
<h3 class="font-display text-display text-primary">A-</h3>
<p class="text-body-md text-green-600 mt-xs font-bold">+0.4 from last term</p>
</div>
<div class="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl">
<div class="flex items-center justify-between mb-sm">
<span class="text-on-surface-variant font-label-md">Total Paid</span>
<span class="material-symbols-outlined text-secondary">payments</span>
</div>
<h3 class="font-display text-display text-primary">Rs 42,000</h3>
<p class="text-body-md text-on-surface-variant mt-xs">Across 6 installments</p>
</div>
<div class="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl border-l-4 border-l-error">
<div class="flex items-center justify-between mb-sm">
<span class="text-on-surface-variant font-label-md">Outstanding Balance</span>
<span class="material-symbols-outlined text-error">warning</span>
</div>
<h3 class="font-display text-display text-error">Rs 8,500</h3>
<p class="text-body-md text-on-surface-variant mt-xs">Due in 5 days</p>
</div>
</section>
<!-- Tabbed Content Section -->
<section class="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden shadow-sm">
<div class="flex border-b border-outline-variant px-lg bg-surface">
<button class="tab-btn px-lg py-md font-bold text-body-md transition-colors" id="tab-btn-academic" onclick="switchTab('academic')">Academic History</button>
<button class="tab-btn px-lg py-md font-bold text-body-md text-on-surface-variant hover:text-primary transition-colors active-tab" id="tab-btn-fee" onclick="switchTab('fee')">Fee History</button>
<button class="tab-btn px-lg py-md font-bold text-body-md text-on-surface-variant hover:text-primary transition-colors" id="tab-btn-personal" onclick="switchTab('personal')">Personal Info</button>
</div>
<!-- Academic History Tab Content -->
<div class="tab-content p-lg hidden" id="tab-content-academic">
<div class="space-y-lg">
<div class="flex items-start gap-lg border-l-2 border-secondary relative pl-lg pb-lg">
<div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-secondary"></div>
<div class="flex-1">
<div class="flex justify-between items-start">
<div>
<h4 class="font-headline-md text-primary">UX/UI Mastery: Advanced Pro</h4>
<p class="text-on-surface-variant font-label-md">Batch: B-2024-ALPHA • Instructor: Elena Vance</p>
</div>
<span class="px-md py-xs bg-secondary-fixed text-on-secondary-fixed-variant text-[10px] font-bold rounded uppercase">In Progress</span>
</div>
<p class="text-body-md mt-md text-on-surface p-md bg-surface-container rounded-lg italic">
                                    "Arjun shows exceptional aptitude in visual hierarchy. He has successfully completed the first 3 sprints with distinction. Current focus: Accessibility standards and advanced prototyping."
                                </p>
</div>
</div>
<div class="flex items-start gap-lg border-l-2 border-outline-variant relative pl-lg pb-lg">
<div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-outline-variant"></div>
<div class="flex-1 opacity-70">
<div class="flex justify-between items-start">
<div>
<h4 class="font-headline-md text-primary">Design Foundations 101</h4>
<p class="text-on-surface-variant font-label-md">Batch: B-2023-GAMMA • Instructor: Marcus Wright</p>
</div>
<span class="px-md py-xs bg-surface-container-highest text-on-surface-variant text-[10px] font-bold rounded uppercase">Completed</span>
</div>
<p class="text-body-md mt-sm text-on-surface">Final Grade: A+ (98/100). Successfully mastered grid systems, color theory, and typography principles.</p>
</div>
</div>
</div>
</div>
<!-- Fee History Tab Content (Hidden by default) -->
<div class="tab-content p-lg block" id="tab-content-fee"><div class="overflow-x-auto"><table class="w-full text-left"><thead class="bg-surface-container text-on-surface-variant"><tr><th class="px-md py-sm font-label-md uppercase">Date</th><th class="px-md py-sm font-label-md uppercase">Voucher No</th><th class="px-md py-sm font-label-md uppercase">Fee Component</th><th class="px-md py-sm font-label-md uppercase">Amount</th><th class="px-md py-sm font-label-md uppercase">Payment Method</th><th class="px-md py-sm font-label-md uppercase">Status</th><th class="px-md py-sm font-label-md uppercase text-right">Action</th></tr></thead><tbody class="divide-y divide-outline-variant"><tr class="hover:bg-primary/5 transition-colors"><td class="px-md py-md font-body-md">Oct 05, 2024</td><td class="px-md py-md font-mono-data">#VCH-98210</td><td class="px-md py-md font-body-md">Monthly Tuition - Oct</td><td class="px-md py-md font-body-md font-bold">Rs 5,500</td><td class="px-md py-md font-body-md">Bank Transfer</td><td class="px-md py-md"><span class="px-sm py-xs bg-error-container text-on-error-container text-[10px] font-bold rounded">OVERDUE</span></td><td class="px-md py-md text-right"><button class="text-secondary hover:underline font-label-md">Remind</button></td></tr><tr class="hover:bg-primary/5 transition-colors"><td class="px-md py-md font-body-md">Sep 05, 2024</td><td class="px-md py-md font-mono-data">#VCH-97402</td><td class="px-md py-md font-body-md">Monthly Tuition - Sep</td><td class="px-md py-md font-body-md font-bold">Rs 5,500</td><td class="px-md py-md font-body-md">Cash</td><td class="px-md py-md"><span class="px-sm py-xs bg-green-100 text-green-700 text-[10px] font-bold rounded">PAID</span></td><td class="px-md py-md text-right"><button class="text-on-surface-variant hover:text-primary"><span class="material-symbols-outlined">download</span></button></td></tr><tr class="hover:bg-primary/5 transition-colors"><td class="px-md py-md font-body-md">Aug 20, 2024</td><td class="px-md py-md font-mono-data">#VCH-96115</td><td class="px-md py-md font-body-md">Admission Fee</td><td class="px-md py-md font-body-md font-bold">Rs 15,000</td><td class="px-md py-md font-body-md">Bank Transfer</td><td class="px-md py-md"><span class="px-sm py-xs bg-green-100 text-green-700 text-[10px] font-bold rounded">PAID</span></td><td class="px-md py-md text-right"><button class="text-on-surface-variant hover:text-primary"><span class="material-symbols-outlined">download</span></button></td></tr><tr class="hover:bg-primary/5 transition-colors"><td class="px-md py-md font-body-md">Aug 20, 2024</td><td class="px-md py-md font-mono-data">#VCH-96116</td><td class="px-md py-md font-body-md">Annual Facility Fee</td><td class="px-md py-md font-body-md font-bold">Rs 2,500</td><td class="px-md py-md font-body-md">Bank Transfer</td><td class="px-md py-md"><span class="px-sm py-xs bg-secondary-fixed text-on-secondary-fixed-variant text-[10px] font-bold rounded">PARTIALLY PAID</span></td><td class="px-md py-md text-right"><button class="text-on-surface-variant hover:text-primary"><span class="material-symbols-outlined">download</span></button></td></tr></tbody></table></div></div>
<!-- Personal Info Tab Content (Hidden by default) -->
<div class="tab-content p-lg hidden" id="tab-content-personal">
<div class="grid grid-cols-1 md:grid-cols-2 gap-xl">
<div>
<h5 class="text-primary font-bold mb-md flex items-center gap-sm">
<span class="material-symbols-outlined">contact_mail</span>
                                Contact Details
                            </h5>
<div class="space-y-md">
<div>
<label class="font-label-md text-on-surface-variant block">Email Address</label>
<p class="font-body-md text-primary">arjun.mehta@university.edu</p>
</div>
<div>
<label class="font-label-md text-on-surface-variant block">Phone Number</label>
<p class="font-body-md text-primary">+1 (555) 0123-4567</p>
</div>
<div>
<label class="font-label-md text-on-surface-variant block">Current Address</label>
<p class="font-body-md text-primary">241 High Street, Apartment 4B<br>North Kensington, London W11 4UA</p>
</div>
</div>
</div>
<div>
<h5 class="text-primary font-bold mb-md flex items-center gap-sm">
<span class="material-symbols-outlined">family_restroom</span>
                                Guardian Information
                            </h5>
<div class="space-y-md">
<div>
<label class="font-label-md text-on-surface-variant block">Primary Guardian</label>
<p class="font-body-md text-primary">Rajesh Mehta (Father)</p>
</div>
<div>
<label class="font-label-md text-on-surface-variant block">Emergency Contact</label>
<p class="font-body-md text-primary">+1 (555) 9876-5432</p>
</div>
<div>
<label class="font-label-md text-on-surface-variant block">Relationship</label>
<p class="font-body-md text-primary">Primary Legal Guardian</p>
</div>
</div>
</div>
</div>
</div>
</section>
</div>
</main>` }} />
  );
}
