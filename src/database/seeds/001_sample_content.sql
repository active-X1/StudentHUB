-- DEVELOPMENT SAMPLE DATA ONLY (the seed runner refuses to run in production).
-- Mirrors the Phase 1 prototype content. All people and addresses are fictional (example.org is reserved for documentation).
-- Sample users have NO password and NO OAuth identity, so nobody can sign in as them.
-- NO admin account is created here: the initial admin is provisioned by a controlled bootstrap in Phase 3.
-- Safe to re-run: every insert ignores rows that already exist.

INSERT INTO users (id, email, display_name, department, study_level, bio) VALUES
  ('00000000-0000-4000-8000-000000000001', 'mensah@example.org',  'Dr. Mensah',    'Computer Science', NULL,     NULL),
  ('00000000-0000-4000-8000-000000000002', 'office@example.org',   'Dept. Office',  'Computer Science', NULL,     NULL),
  ('00000000-0000-4000-8000-000000000003', 'kemi@example.org',     'Kemi Adeyemi',  'Computer Science', 'Year 3', NULL),
  ('00000000-0000-4000-8000-000000000004', 'amara@example.org',    'Amara Nwosu',   'Computer Science', 'Year 2', 'Curious about algorithms and open-source.')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id) VALUES
  ('00000000-0000-4000-8000-000000000001', 2),
  ('00000000-0000-4000-8000-000000000002', 2),
  ('00000000-0000-4000-8000-000000000003', 1),
  ('00000000-0000-4000-8000-000000000004', 1)
ON CONFLICT DO NOTHING;

INSERT INTO hashtags (name) VALUES
  ('ComputerScience'), ('Assignments'), ('Programming'), ('LectureNotes'), ('Exams'), ('DepartmentNews')
ON CONFLICT DO NOTHING;

INSERT INTO feed_posts (id, author_id, category, body, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000002', 'Announcement',
   'Mid-semester exam timetable is out. Please read the exam rules and arrive 20 minutes early with your student ID.', 'published', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000001', 'Study Material',
   'Week 5 lecture notes on linked lists and stacks are posted. Try the practice problems before Thursday. Tip: draw the pointers!', 'published', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000003', 'Resource',
   'Found a great free visualiser for sorting algorithms. It really helped me understand quicksort partitioning.', 'published', now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000002', 'Event',
   'Department hackathon sign-ups are open. Teams of up to four. Mentors from industry will be available all day.', 'published', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000000001', 'Class Info',
   'CSC 310 tutorial moves to Room B12 this week. Bring your lab laptops.', 'published', now() - interval '5 days'),
  ('00000000-0000-4000-8000-000000001006', '00000000-0000-4000-8000-000000000001', 'Study Material',
   'Past-question style practice set for database normalization. Solutions will be discussed next class.', 'published', now() - interval '6 days')
ON CONFLICT DO NOTHING;

INSERT INTO post_hashtags (post_id, hashtag_id)
SELECT v.post_id::uuid, h.id
FROM (VALUES
  ('00000000-0000-4000-8000-000000001001', 'Exams'), ('00000000-0000-4000-8000-000000001001', 'DepartmentNews'),
  ('00000000-0000-4000-8000-000000001002', 'LectureNotes'), ('00000000-0000-4000-8000-000000001002', 'ComputerScience'), ('00000000-0000-4000-8000-000000001002', 'Programming'),
  ('00000000-0000-4000-8000-000000001003', 'Programming'), ('00000000-0000-4000-8000-000000001003', 'ComputerScience'),
  ('00000000-0000-4000-8000-000000001004', 'DepartmentNews'), ('00000000-0000-4000-8000-000000001004', 'ComputerScience'),
  ('00000000-0000-4000-8000-000000001005', 'Assignments'), ('00000000-0000-4000-8000-000000001005', 'DepartmentNews'),
  ('00000000-0000-4000-8000-000000001006', 'Exams'), ('00000000-0000-4000-8000-000000001006', 'Assignments'), ('00000000-0000-4000-8000-000000001006', 'LectureNotes')
) AS v(post_id, tag)
JOIN hashtags h ON lower(h.name) = lower(v.tag)
ON CONFLICT DO NOTHING;

INSERT INTO comments (id, post_id, author_id, body) VALUES
  ('00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000003', 'Is the CSC 220 paper in the morning?'),
  ('00000000-0000-4000-8000-000000002002', '00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000001', 'Nice find, thanks for sharing!')
ON CONFLICT DO NOTHING;

INSERT INTO reactions (post_id, user_id) VALUES
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000004')
ON CONFLICT DO NOTHING;

INSERT INTO post_suggestions (id, author_id, category, body, tags) VALUES
  ('00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000000003', 'Study Material',
   'Graph traversal cheat sheet: BFS vs DFS with complexity notes.', ARRAY['Programming', 'LectureNotes'])
ON CONFLICT DO NOTHING;

INSERT INTO general_assignments (id, title, course, category, description, due_date, status, published_at, created_by) VALUES
  ('00000000-0000-4000-8000-000000004001', 'Normalization exercise (1NF–3NF)', 'CSC 220 Databases', 'Coursework',
   'Normalize the provided order-management schema to 3NF. Show each step and justify decompositions.', current_date + 6, 'published', now() - interval '1 day', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000004002', 'Linked list implementation lab', 'CSC 201 Data Structures', 'Lab',
   'Implement singly and doubly linked lists. Submit source files and a short README.', current_date + 3, 'published', now() - interval '3 days', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000004003', 'Deadlock detection write-up', 'CSC 310 Operating Systems', 'Coursework',
   'Explain the resource-allocation graph method with two worked examples.', current_date + 10, 'published', now() - interval '5 days', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000004004', 'Set theory problem sheet', 'MTH 210 Discrete Math', 'Problem set',
   'Problem sheet 3. Show full working for each question.', current_date + 1, 'published', now() - interval '7 days', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000004005', 'Mini project: command-line todo app', 'CSC 101 Intro to Programming', 'Project',
   'Build a CLI todo manager with add, list, complete and delete commands.', current_date + 14, 'published', now() - interval '10 days', '00000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO general_assignment_hashtags (assignment_id, hashtag_id)
SELECT v.assignment_id::uuid, h.id
FROM (VALUES
  ('00000000-0000-4000-8000-000000004001', 'Assignments'), ('00000000-0000-4000-8000-000000004001', 'ComputerScience'),
  ('00000000-0000-4000-8000-000000004002', 'Programming'), ('00000000-0000-4000-8000-000000004002', 'Assignments'),
  ('00000000-0000-4000-8000-000000004003', 'Assignments'),
  ('00000000-0000-4000-8000-000000004004', 'Assignments'), ('00000000-0000-4000-8000-000000004004', 'Exams'),
  ('00000000-0000-4000-8000-000000004005', 'Programming'), ('00000000-0000-4000-8000-000000004005', 'Assignments')
) AS v(assignment_id, tag)
JOIN hashtags h ON lower(h.name) = lower(v.tag)
ON CONFLICT DO NOTHING;

-- Private assignments belong to the sample student "Amara" only.
INSERT INTO personal_assignments (id, user_id, title, description, course, lecturer, due_date, priority, status, completed_at) VALUES
  ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-000000000004', 'Implement a binary search tree',
   'Insert, delete and in-order traversal in Python with unit tests.', 'CSC 201 Data Structures', 'Dr. Mensah', current_date + 2, 'high', 'in-progress', NULL),
  ('00000000-0000-4000-8000-000000005002', '00000000-0000-4000-8000-000000000004', 'ER diagram for library system',
   'Design entities, relationships and keys. Export as PDF.', 'CSC 220 Databases', NULL, current_date + 5, 'medium', 'todo', NULL),
  ('00000000-0000-4000-8000-000000005003', '00000000-0000-4000-8000-000000000004', 'Hello World lab report',
   'Short report on the first lab.', 'CSC 101 Intro to Programming', NULL, current_date - 6, 'low', 'done', now() - interval '7 days')
ON CONFLICT DO NOTHING;

INSERT INTO personal_assignment_hashtags (assignment_id, hashtag_id)
SELECT v.assignment_id::uuid, h.id
FROM (VALUES
  ('00000000-0000-4000-8000-000000005001', 'Programming'), ('00000000-0000-4000-8000-000000005001', 'Assignments'),
  ('00000000-0000-4000-8000-000000005002', 'Assignments'), ('00000000-0000-4000-8000-000000005003', 'Programming')
) AS v(assignment_id, tag)
JOIN hashtags h ON lower(h.name) = lower(v.tag)
ON CONFLICT DO NOTHING;
