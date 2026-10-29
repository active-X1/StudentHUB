// ALL DATA HERE IS FICTIONAL SAMPLE DATA for the Phase 1 prototype. No real people, emails, or files.
// Dates are generated relative to "today" so deadlines always look realistic.
const day = (n, h = 9) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };
const dateOnly = (n) => day(n).slice(0, 10);

export const COURSES = ['CSC 101 Intro to Programming', 'CSC 201 Data Structures', 'CSC 220 Databases', 'CSC 310 Operating Systems', 'MTH 210 Discrete Math'];
export const FEED_CATEGORIES = ['Announcement', 'Study Material', 'Class Info', 'Resource', 'Event'];
export const HASHTAGS = ['ComputerScience', 'Assignments', 'Programming', 'LectureNotes', 'Exams', 'DepartmentNews'];

export const currentUser = {
  id: 'u_demo', name: 'Amara Nwosu', email: 'amara.demo@example.edu', provider: 'email',
  department: 'Computer Science', level: 'Year 2', bio: 'Curious about algorithms and open-source.', isSample: true,
};

export const announcements = [
  { id: 'a1', title: 'Mid-semester exams timetable released', body: 'The provisional timetable for CSC 201, CSC 220 and MTH 210 is now available. Check your venue and time.', category: 'Exams', c1: '#0f766e', c2: '#4338ca', status: 'published', date: day(-1) },
  { id: 'a2', title: 'Department hackathon: sign-ups open', body: 'Form teams of up to four. Prizes, mentorship and snacks. Registration closes in two weeks.', category: 'Event', c1: '#b45309', c2: '#be185d', status: 'published', date: day(-2) },
  { id: 'a3', title: 'New lab hours for the Systems Lab', body: 'The Systems Lab now opens 8am–8pm on weekdays. Bring your student ID.', category: 'Department News', c1: '#1d4ed8', c2: '#7c3aed', status: 'published', date: day(-4) },
];

export const news = [
  { id: 'n1', title: 'Guest lecture: Building reliable distributed systems', meta: 'Department News · 2 days ago', status: 'published', date: day(-2) },
  { id: 'n2', title: 'Library adds 40 new programming titles', meta: 'Resources · 3 days ago', status: 'published', date: day(-3) },
  { id: 'n3', title: 'Final-year project proposal guidelines updated', meta: 'Announcement · 5 days ago', status: 'published', date: day(-5) },
  { id: 'n4', title: 'Peer tutoring sessions start Monday', meta: 'Class Info · 6 days ago', status: 'published', date: day(-6) },
];

export const activity = [
  { id: 'ac1', text: 'New study material posted in CSC 201', time: day(0, 7) },
  { id: 'ac2', text: 'Your suggestion “Graph traversal cheat sheet” is pending review (sample)', time: day(-1, 15) },
  { id: 'ac3', text: 'General assignment “Normalization exercise” was published', time: day(-1, 10) },
  { id: 'ac4', text: 'Dr. Mensah commented on “Recursion tips”', time: day(-2, 12) },
];

export const posts = [
  { id: 'p1', author: 'Dept. Office', role: 'Admin', category: 'Announcement', date: day(-1, 8), status: 'published',
    text: 'Mid-semester exam timetable is out. Please read the exam rules and arrive 20 minutes early with your student ID.', tags: ['Exams', 'DepartmentNews'], likes: 42, liked: false,
    attachments: [{ name: 'midsem-timetable-sample.pdf', size: 184320, type: 'application/pdf' }], comments: [{ id: 'c1', author: 'Tobi A.', text: 'Is the CSC 220 paper in the morning?', date: day(-1, 11) }] },
  { id: 'p2', author: 'Dr. Mensah', role: 'Lecturer', category: 'Study Material', date: day(-2, 14), status: 'published',
    text: 'Week 5 lecture notes on linked lists and stacks are attached. Try the practice problems before Thursday.\nTip: draw the pointers!', tags: ['LectureNotes', 'ComputerScience', 'Programming'], likes: 31, liked: true,
    attachments: [{ name: 'week5-linked-lists-sample.pdf', size: 902144, type: 'application/pdf' }, { name: 'stack-diagram-sample.png', size: 120400, type: 'image/png' }], comments: [] },
  { id: 'p3', author: 'Kemi Adeyemi', role: 'Student', category: 'Resource', date: day(-3, 18), status: 'published',
    text: 'Found a great free visualiser for sorting algorithms. It really helped me understand quicksort partitioning.', tags: ['Programming', 'ComputerScience'], likes: 18, liked: false, attachments: [], comments: [{ id: 'c2', author: 'Dr. Mensah', text: 'Nice find, thanks for sharing!', date: day(-3, 20) }] },
  { id: 'p4', author: 'Dept. Office', role: 'Admin', category: 'Event', date: day(-4, 9), status: 'published',
    text: 'Department hackathon sign-ups are open. Teams of up to four. Mentors from industry will be available all day.', tags: ['DepartmentNews', 'ComputerScience'], likes: 57, liked: false, attachments: [], comments: [] },
  { id: 'p5', author: 'Prof. Okoro', role: 'Lecturer', category: 'Class Info', date: day(-5, 10), status: 'published',
    text: 'CSC 310 tutorial moves to Room B12 this week. Bring your lab laptops.', tags: ['Assignments', 'DepartmentNews'], likes: 12, liked: false, attachments: [], comments: [] },
  { id: 'p6', author: 'Dr. Mensah', role: 'Lecturer', category: 'Study Material', date: day(-6, 13), status: 'published',
    text: 'Past-question style practice set for database normalization. Solutions will be discussed next class.', tags: ['Exams', 'Assignments', 'LectureNotes'], likes: 26, liked: false,
    attachments: [{ name: 'normalization-practice-sample.docx', size: 54000, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }], comments: [] },
  { id: 'p7', author: 'Ife Balogun', role: 'Student', category: 'Resource', date: day(-8, 16), status: 'published',
    text: 'Study group for Discrete Math meets Wednesdays at the library, level 2. Everyone is welcome!', tags: ['Exams', 'ComputerScience'], likes: 9, liked: false, attachments: [], comments: [] },
  { id: 'p8', author: 'Dept. Office', role: 'Admin', category: 'Announcement', date: day(-9, 8), status: 'published',
    text: 'Reminder: final-year project proposal guidelines were updated. Read them before booking supervisor meetings.', tags: ['DepartmentNews', 'Assignments'], likes: 20, liked: false, attachments: [], comments: [] },
];

export const myAssignments = [
  { id: 'm1', title: 'Implement a binary search tree', description: 'Insert, delete and in-order traversal in Python with unit tests.', course: 'CSC 201 Data Structures', lecturer: 'Dr. Mensah', due: dateOnly(2), priority: 'high', status: 'in-progress', tags: ['Programming', 'Assignments'], attachments: [] },
  { id: 'm2', title: 'ER diagram for library system', description: 'Design entities, relationships and keys. Export as PDF.', course: 'CSC 220 Databases', lecturer: 'Prof. Okoro', due: dateOnly(5), priority: 'medium', status: 'todo', tags: ['Assignments'], attachments: [] },
  { id: 'm3', title: 'Process scheduling worksheet', description: 'Round-robin and SJF calculations.', course: 'CSC 310 Operating Systems', lecturer: '', due: dateOnly(-1), priority: 'high', status: 'todo', tags: ['Exams'], attachments: [] },
  { id: 'm4', title: 'Proof by induction problems', description: 'Problems 1–6 from chapter 4.', course: 'MTH 210 Discrete Math', lecturer: 'Dr. Eze', due: dateOnly(9), priority: 'low', status: 'todo', tags: [], attachments: [] },
  { id: 'm5', title: 'Hello World lab report', description: 'Short report on the first lab.', course: 'CSC 101 Intro to Programming', lecturer: '', due: dateOnly(-6), priority: 'low', status: 'done', tags: ['Programming'], attachments: [] },
];

export const generalAssignments = [
  { id: 'g1', title: 'Normalization exercise (1NF–3NF)', course: 'CSC 220 Databases', category: 'Coursework', description: 'Normalize the provided order-management schema to 3NF. Show each step and justify decompositions.', published: day(-1, 10), due: dateOnly(6), tags: ['Assignments', 'ComputerScience'], attachments: [{ name: 'orders-schema-sample.pdf' }], status: 'published' },
  { id: 'g2', title: 'Linked list implementation lab', course: 'CSC 201 Data Structures', category: 'Lab', description: 'Implement singly and doubly linked lists. Submit source files and a short README.', published: day(-3, 9), due: dateOnly(3), tags: ['Programming', 'Assignments'], attachments: [{ name: 'lab3-starter-sample.zip' }], status: 'published' },
  { id: 'g3', title: 'Deadlock detection write-up', course: 'CSC 310 Operating Systems', category: 'Coursework', description: 'Explain the resource-allocation graph method with two worked examples.', published: day(-5, 9), due: dateOnly(10), tags: ['Assignments'], attachments: [], status: 'published' },
  { id: 'g4', title: 'Set theory problem sheet', course: 'MTH 210 Discrete Math', category: 'Problem set', description: 'Problem sheet 3. Show full working for each question.', published: day(-7, 9), due: dateOnly(1), tags: ['Assignments', 'Exams'], attachments: [{ name: 'problem-sheet-3-sample.pdf' }], status: 'published' },
  { id: 'g5', title: 'Mini project: command-line todo app', course: 'CSC 101 Intro to Programming', category: 'Project', description: 'Build a CLI todo manager with add, list, complete and delete commands.', published: day(-10, 9), due: dateOnly(14), tags: ['Programming', 'Assignments'], attachments: [], status: 'published' },
];

// ---- Admin-only sample data ----
export const suggestions = [
  { id: 's1', author: 'Kemi Adeyemi', category: 'Study Material', text: 'Graph traversal cheat sheet: BFS vs DFS with complexity notes.', tags: ['Programming', 'LectureNotes'], date: day(-1, 17), attachments: 1 },
  { id: 's2', author: 'Ife Balogun', category: 'Event', text: 'Peer study group for MTH 210 on Fridays. Looking for volunteers.', tags: ['Exams'], date: day(-2, 12), attachments: 0 },
  { id: 's3', author: 'Tobi Alade', category: 'Resource', text: 'Link roundup: free resources for learning SQL.', tags: ['ComputerScience', 'Programming'], date: day(-3, 8), attachments: 0 },
];
export const adminUsers = [
  ['Amara Nwosu', 'amara.demo@example.edu', 'student', 'email', 'active'], ['Kemi Adeyemi', 'kemi.demo@example.edu', 'student', 'google', 'active'],
  ['Ife Balogun', 'ife.demo@example.edu', 'student', 'github', 'active'], ['Tobi Alade', 'tobi.demo@example.edu', 'student', 'email', 'active'],
  ['Dr. Mensah', 'mensah.demo@example.edu', 'lecturer', 'email', 'active'], ['Prof. Okoro', 'okoro.demo@example.edu', 'lecturer', 'google', 'active'],
  ['Dept. Office', 'office.demo@example.edu', 'admin', 'email', 'active'], ['Chuka Obi', 'chuka.demo@example.edu', 'student', 'email', 'suspended'],
].map(([name, email, role, provider, status], i) => ({ id: `usr${i + 1}`, name, email, role, provider, status, joined: day(-120 + i * 9) }));
export const auditLog = [
  { id: 'l1', actor: 'admin (sample)', action: 'Published post “Mid-semester exam timetable”', time: day(-1, 8) },
  { id: 'l2', actor: 'admin (sample)', action: 'Approved suggestion from Kemi Adeyemi', time: day(-2, 15) },
  { id: 'l3', actor: 'admin (sample)', action: 'Created general assignment “Normalization exercise”', time: day(-3, 10) },
  { id: 'l4', actor: 'system (sample)', action: 'Nightly backup completed', time: day(-3, 2) },
];
export const adminStats = {
  totalUsers: 1284, activeUsers: 612, activePeriod: 'last 30 days', publishedPosts: posts.length, pendingSuggestions: suggestions.length,
  generalAssignments: generalAssignments.length, uploadedResources: 96, weekly: [18, 32, 25, 41, 38, 52, 47],
};
