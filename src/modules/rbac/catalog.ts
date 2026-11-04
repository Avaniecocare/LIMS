/**
 * Permission codes are defined by the code that enforces them; which roles hold them is data.
 * DEFAULT_ROLES only seeds a new deployment. After that an Admin owns the mapping.
 */
export const PERMISSIONS: Record<string, { module: string; description: string }> = {
  'admin.users': { module: 'Admin', description: 'Manage users' },
  'admin.roles': { module: 'Admin', description: 'Manage roles and permissions' },
  'admin.settings': { module: 'Admin', description: 'Change lab operating settings' },
  'admin.audit': { module: 'Admin', description: 'View the audit log' },
  'admin.company.view': { module: 'Admin', description: 'View company details' },

  'masters.view': { module: 'Masters', description: 'View master data' },
  'masters.edit': { module: 'Masters', description: 'Create and edit master data' },
  'rates.view': { module: 'Masters', description: 'View standard and customer rates' },
  'rates.edit': { module: 'Masters', description: 'Create and edit rates' },

  'customers.view': { module: 'Customers', description: 'View customer identity and contacts' },
  'customers.edit': { module: 'Customers', description: 'Create and edit customers' },
  'orders.view': { module: 'Orders', description: 'View orders' },
  'orders.edit': { module: 'Orders', description: 'Create and edit orders' },

  'quotations.view': { module: 'Quotations', description: 'View quotations' },
  'quotations.edit': { module: 'Quotations', description: 'Create and revise quotations' },
  'quotations.send': { module: 'Quotations', description: 'Send quotations to customers' },
  'quotations.decide': { module: 'Quotations', description: 'Mark quotations accepted or rejected' },
  'quotations.rateOverride': { module: 'Quotations', description: 'Override a looked-up rate' },
  'quotations.convert': { module: 'Quotations', description: 'Convert an accepted quotation to a job' },

  'jobs.view': { module: 'Samples', description: 'View jobs and samples' },
  'jobs.create': { module: 'Samples', description: 'Book jobs and samples' },
  'jobs.createWithoutQuotation': { module: 'Samples', description: 'Book a job without a quotation' },
  'jobs.edit': { module: 'Samples', description: 'Edit jobs and samples, record deviations' },
  'jobs.hold': { module: 'Samples', description: 'Hold and release jobs' },
  'jobs.cancel': { module: 'Samples', description: 'Cancel jobs, samples and tests' },

  'planning.view': { module: 'Planning', description: 'View planning and workload' },
  'planning.edit': { module: 'Planning', description: 'Plan tests and assign technicians' },

  'tests.viewAll': { module: 'Testing', description: 'View all tests, not only assigned ones' },
  'tests.work': { module: 'Testing', description: 'Work on assigned tests and enter results' },
  'tests.approve': { module: 'Testing', description: 'Approve or reject test results' },
  'tests.hold': { module: 'Testing', description: 'Hold and release tests' },

  'reports.view': { module: 'Reports', description: 'View test reports' },
  'reports.review': { module: 'Reports', description: 'Review draft reports' },
  'reports.approve': { module: 'Reports', description: 'Final approval and electronic signature' },
  'reports.issue': { module: 'Reports', description: 'Issue and email reports' },
  'reports.revise': { module: 'Reports', description: 'Start a report revision' },

  'dispatch.view': { module: 'Dispatch', description: 'View dispatches' },
  'dispatch.edit': { module: 'Dispatch', description: 'Record dispatches and sample returns' },

  'invoices.view': { module: 'Invoices', description: 'View invoices and amounts' },
  'invoices.edit': { module: 'Invoices', description: 'Create, issue and cancel invoices' },
  'payments.edit': { module: 'Invoices', description: 'Record payments and credit notes' },
  'reminders.send': { module: 'Invoices', description: 'Send payment reminders' },

  'analytics.operations': { module: 'Analytics', description: 'View operations dashboards' },
  'analytics.quality': { module: 'Analytics', description: 'View quality dashboards' },
  'analytics.people': { module: 'Analytics', description: 'View people and equipment dashboards' },
  'analytics.commercial': { module: 'Analytics', description: 'View commercial dashboards' },
  'mis.view': { module: 'Reports module', description: 'View operational reports' },
  'mis.commercial': { module: 'Reports module', description: 'View commercial reports' },
};

const all = Object.keys(PERMISSIONS);

export const DEFAULT_ROLES: Record<string, { description: string; permissions: string[] }> = {
  Admin: {
    description: 'Users, roles, masters, settings, audit log, all records',
    permissions: all.filter((p) => p !== 'tests.work'),
  },
  'Sales / Business Development': {
    description: 'Customers, orders, quotations',
    permissions: [
      'customers.view', 'customers.edit', 'orders.view', 'orders.edit', 'quotations.view', 'quotations.edit', 'quotations.send',
      'quotations.decide', 'quotations.rateOverride', 'quotations.convert', 'masters.view', 'rates.view', 'jobs.view',
    ],
  },
  'Sample Reception': {
    description: 'Job booking, SRF, acknowledgements, labels, deviations',
    permissions: ['customers.view', 'quotations.convert', 'jobs.view', 'jobs.create', 'jobs.createWithoutQuotation', 'jobs.edit', 'jobs.hold', 'masters.view', 'mis.view'],
  },
  'Lab Manager / Planner': {
    description: 'Test planning, assignment, job cards, workload',
    permissions: ['jobs.view', 'jobs.hold', 'jobs.cancel', 'planning.view', 'planning.edit', 'tests.viewAll', 'tests.hold', 'masters.view', 'analytics.operations', 'analytics.people', 'mis.view'],
  },
  'Technician / Analyst': {
    description: 'Assigned tests only: stages, results, attachments',
    permissions: ['tests.work'],
  },
  'Head of Department': {
    description: 'Approves test results',
    permissions: ['tests.viewAll', 'tests.approve', 'tests.hold', 'masters.view', 'analytics.quality', 'analytics.people', 'mis.view'],
  },
  'Report Reviewer': {
    description: 'Reviews draft reports',
    permissions: ['reports.view', 'reports.review', 'jobs.view', 'customers.view', 'tests.viewAll', 'analytics.quality'],
  },
  'Authorised Signatory': {
    description: 'Final approval or rejection, electronic signature',
    permissions: ['reports.view', 'reports.approve', 'reports.issue', 'reports.revise', 'jobs.view', 'customers.view', 'tests.viewAll', 'analytics.quality'],
  },
  Dispatch: {
    description: 'Dispatch records and challans',
    permissions: ['dispatch.view', 'dispatch.edit', 'reports.view', 'jobs.view', 'customers.view', 'masters.view'],
  },
  Accounts: {
    description: 'Rates, invoices, payments, due invoices',
    permissions: ['customers.view', 'jobs.view', 'reports.view', 'masters.view', 'rates.view', 'rates.edit', 'invoices.view', 'invoices.edit', 'payments.edit', 'reminders.send', 'analytics.commercial', 'mis.commercial'],
  },
  Management: {
    description: 'Read-only dashboards and reports',
    permissions: [
      'customers.view', 'orders.view', 'quotations.view', 'jobs.view', 'planning.view', 'tests.viewAll', 'reports.view', 'dispatch.view', 'invoices.view', 'masters.view', 'rates.view',
      'analytics.operations', 'analytics.quality', 'analytics.people', 'analytics.commercial', 'mis.view', 'mis.commercial',
    ],
  },
};
