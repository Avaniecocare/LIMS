-- Repeatable load data: 500,000 tests across 125,000 samples and 50,000 jobs, for one fictional customer set.
-- Run against an empty, migrated database dedicated to load testing. Rows are flagged isDemo.
BEGIN;
INSERT INTO "User"("id","email","name","passwordHash","updatedAt") SELECT '00000000-0000-4000-8000-' || lpad(g::text, 12, '0'), 'tech' || g || '@load.example', 'Load Tech ' || g, 'x', now() FROM generate_series(1, 25) g ON CONFLICT DO NOTHING;
INSERT INTO "Customer"("id","crn","name","stateName","stateCode","updatedAt","isDemo") SELECT 'load-cust-' || g, 'LOAD-' || g, 'Load Customer ' || g, 'Maharashtra', '27', now(), true FROM generate_series(1, 2000) g ON CONFLICT DO NOTHING;
INSERT INTO "TestMaster"("id","code","name","updatedAt","isDemo") SELECT 'load-test-' || g, 'LT' || g, 'Load Test ' || g, now(), true FROM generate_series(1, 200) g ON CONFLICT DO NOTHING;
INSERT INTO "Job"("id","jobNo","customerId","status","receivedAt","updatedAt","urgent","isDemo")
  SELECT 'load-job-' || g, 'LOAD/JOB/' || lpad(g::text, 7, '0'), 'load-cust-' || (1 + g % 2000),
    (ARRAY['RECEIVED','PLANNED','IN_TESTING','REPORTING','COMPLETED'])[1 + g % 5]::"JobStatus",
    now() - (g % 700) * interval '1 day', now(), g % 20 = 0, true FROM generate_series(1, 50000) g;
INSERT INTO "Sample"("id","sampleNo","jobId","description","status","createdAt","updatedAt","returnable","isDemo")
  SELECT 'load-sam-' || g, 'LOAD/S/' || lpad(g::text, 7, '0'), 'load-job-' || (1 + g % 50000), 'Sample ' || g,
    (ARRAY['RECEIVED','PLANNED','IN_TESTING','REPORTING','COMPLETED'])[1 + g % 5]::"SampleStatus",
    now() - (g % 700) * interval '1 day', now(), g % 10 = 0, true FROM generate_series(1, 125000) g;
INSERT INTO "SampleTest"("id","sampleId","testId","testCode","testName","status","assignedToId","urgent","dueDate","plannedAt","createdAt","updatedAt","rate","isDemo")
  SELECT 'load-st-' || g, 'load-sam-' || (1 + g % 125000), 'load-test-' || (1 + g % 200), 'LT' || (1 + g % 200), 'Load Test ' || (1 + g % 200),
    (ARRAY['PLANNED','ASSIGNED','IN_PROGRESS','RESULTS_SUBMITTED','APPROVED'])[1 + g % 5]::"TestStatus",
    CASE WHEN g % 5 = 0 THEN NULL ELSE '00000000-0000-4000-8000-' || lpad((1 + g % 25)::text, 12, '0') END, g % 20 = 0,
    (now() + ((g % 400) - 200) * interval '1 day')::date, now() - (g % 700) * interval '1 day', now() - (g % 700) * interval '1 day', now(), 100, true FROM generate_series(1, 500000) g;
COMMIT;
ANALYZE;
