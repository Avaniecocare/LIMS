-- Repeatable load data: 500,000 tests across 125,000 samples and 50,000 jobs, for one fictional customer set.
-- __OPEN__ is the share of work still open, in percent: 4 is a large lab with years of history (20,000 tests open); 100 is
-- far beyond any lab, as a stress (400,000 open).
-- Run against an empty, migrated database dedicated to load testing. Rows are flagged isDemo.
BEGIN;
INSERT INTO "User"("id","email","name","passwordHash","updatedAt") SELECT '00000000-0000-4000-8000-' || lpad(g::text, 12, '0'), 'tech' || g || '@load.example', 'Load Tech ' || g, 'x', now() FROM generate_series(1, 25) g ON CONFLICT DO NOTHING;
INSERT INTO "Customer"("id","crn","name","stateName","stateCode","updatedAt","isDemo") SELECT 'load-cust-' || g, 'LOAD-' || g, 'Load Customer ' || g, 'Maharashtra', '27', now(), true FROM generate_series(1, 2000) g ON CONFLICT DO NOTHING;
INSERT INTO "TestMaster"("id","code","name","updatedAt","isDemo") SELECT 'load-test-' || g, 'LT' || g, 'Load Test ' || g, now(), true FROM generate_series(1, 200) g ON CONFLICT DO NOTHING;
-- A job's work is open when its number falls in the open share; the rest is finished, and months old.
CREATE FUNCTION pg_temp.open_job(k bigint) RETURNS boolean IMMUTABLE LANGUAGE sql AS $$ SELECT k % 100 < __OPEN__ $$;
CREATE FUNCTION pg_temp.age(k bigint, g bigint) RETURNS interval IMMUTABLE LANGUAGE sql AS $$ SELECT CASE WHEN __OPEN__ >= 100 THEN g % 700 WHEN k % 100 < __OPEN__ THEN g % 30 ELSE 30 + k % 1000 END * interval '1 day' $$;
INSERT INTO "Job"("id","jobNo","customerId","status","receivedAt","updatedAt","urgent","isDemo")
  SELECT 'load-job-' || g, 'LOAD/JOB/' || lpad(g::text, 7, '0'), 'load-cust-' || (1 + g % 2000),
    CASE WHEN pg_temp.open_job(g) THEN (ARRAY['RECEIVED','PLANNED','IN_TESTING','REPORTING','COMPLETED'])[1 + g % 5] ELSE 'COMPLETED' END::"JobStatus",
    now() - pg_temp.age(g, g), now(), g % 20 = 0, true FROM generate_series(1, 50000) g;
INSERT INTO "Sample"("id","sampleNo","jobId","description","status","createdAt","updatedAt","returnable","isDemo")
  SELECT 'load-sam-' || g, 'LOAD/S/' || lpad(g::text, 7, '0'), 'load-job-' || k, 'Sample ' || g,
    CASE WHEN pg_temp.open_job(k) THEN (ARRAY['RECEIVED','PLANNED','IN_TESTING','REPORTING','COMPLETED'])[1 + g % 5] ELSE 'COMPLETED' END::"SampleStatus",
    now() - pg_temp.age(k, g), now(), g % 10 = 0, true FROM (SELECT g, 1 + g % 50000 AS k FROM generate_series(1, 125000) g) x;
INSERT INTO "SampleTest"("id","sampleId","testId","testCode","testName","status","assignedToId","urgent","dueDate","plannedAt","approvedAt","createdAt","updatedAt","rate","isDemo")
  SELECT 'load-st-' || g, 'load-sam-' || sg, 'load-test-' || (1 + g % 200), 'LT' || (1 + g % 200), 'Load Test ' || (1 + g % 200),
    CASE WHEN pg_temp.open_job(k) THEN (ARRAY['PLANNED','ASSIGNED','IN_PROGRESS','RESULTS_SUBMITTED','APPROVED'])[1 + g % 5] ELSE 'APPROVED' END::"TestStatus",
    CASE WHEN pg_temp.open_job(k) AND g % 5 = 0 THEN NULL ELSE '00000000-0000-4000-8000-' || lpad((1 + g % 25)::text, 12, '0') END, g % 20 = 0,
    CASE WHEN __OPEN__ >= 100 THEN now() + ((g % 400) - 200) * interval '1 day' ELSE now() - pg_temp.age(k, g) + interval '10 days' END::date,
    now() - pg_temp.age(k, g), CASE WHEN pg_temp.open_job(k) THEN NULL ELSE now() - pg_temp.age(k, g) + interval '8 days' END, now() - pg_temp.age(k, g), now(), 100, true
  FROM (SELECT g, sg, 1 + sg % 50000 AS k FROM (SELECT g, 1 + g % 125000 AS sg FROM generate_series(1, 500000) g) y) x;
COMMIT;
ANALYZE;
