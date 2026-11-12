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
  'quality.view': { module: 'Quality', description: 'View equipment status, authorisations, training and non-conformances' },
  'quality.manage': { module: 'Quality', description: 'Record calibration and maintenance, authorise staff, and work non-conformances' },
  'privacy.manage': { module: 'Admin', description: 'Handle privacy requests and the data breach log (DPDP Act)' },
  'admin.company.edit': { module: 'Admin', description: 'Edit the lab profile, branding, templates and modules' },

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

  'files.view': { module: 'Files', description: 'Browse the file library and download files' },
  'files.manage': { module: 'Files', description: 'Upload, rename, move and remove library files and folders' },
};

const all = Object.keys(PERMISSIONS);

export const DEFAULT_ROLES: Record<string, { description: string; permissions: string[] }> = {
  'Quality Manager': {
    description: 'Equipment, staff competency, non-conformance and CAPA',
    permissions: ['quality.view', 'quality.manage', 'masters.view', 'tests.viewAll', 'files.view', 'jobs.view'],
  },
  'Document Controller': {
    description: 'File library: folders, uploads, controlled documents',
    permissions: ['files.view', 'files.manage', 'customers.view'],
  },
  Admin: {
    description: 'Users, roles, masters, settings, audit log, all records',
    permissions: all.filter((p) => p !== 'tests.work'),
  },
  'Sales / Business Development': {
    description: 'Customers, orders, quotations',
    permissions: [
      'customers.view',
      'customers.edit',
      'orders.view',
      'orders.edit',
      'quotations.view',
      'quotations.edit',
      'quotations.send',
      'quotations.decide',
      'quotations.rateOverride',
      'quotations.convert',
      'masters.view',
      'rates.view',
      'jobs.view',
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
    permissions: [
      'customers.view',
      'jobs.view',
      'reports.view',
      'masters.view',
      'rates.view',
      'rates.edit',
      'invoices.view',
      'invoices.edit',
      'payments.edit',
      'reminders.send',
      'analytics.commercial',
      'mis.commercial',
    ],
  },
  Management: {
    description: 'Read-only dashboards and reports',
    permissions: [
      'customers.view',
      'orders.view',
      'quotations.view',
      'jobs.view',
      'planning.view',
      'tests.viewAll',
      'reports.view',
      'dispatch.view',
      'invoices.view',
      'masters.view',
      'rates.view',
      'analytics.operations',
      'analytics.quality',
      'analytics.people',
      'analytics.commercial',
      'mis.view',
      'mis.commercial',
    ],
  },
};

/**
 * Changes to roles made after a deployment exists. Each runs once (recorded in Setting) and only adds:
 * it creates a missing built-in role and grants new permissions to built-in roles found by name, so an
 * Admin's own changes are never undone.
 */
export const ROLE_UPGRADES: { key: string; createRoles: string[]; grants: Record<string, string[]> }[] = [
  {
    key: 'rbac.upgrade.files-v1',
    createRoles: ['Document Controller'],
    // TODO(rbac-decision): which existing roles see the file library. Admin, Management and Planner chosen; others ask for access.
    grants: { 'files.view': ['Admin', 'Management', 'Lab Manager / Planner'], 'files.manage': ['Admin'] },
  },
  {
    // The lab profile and branding moved from the environment file into the admin panel.
    key: 'rbac.upgrade.lab-profile-v1',
    createRoles: [],
    grants: { 'admin.company.edit': ['Admin'] },
  },
  {
    // Quality management and the DPDP privacy registers.
    key: 'rbac.upgrade.quality-v1',
    createRoles: ['Quality Manager'],
    grants: { 'quality.view': ['Admin', 'Management', 'Lab Manager / Planner', 'Head of Department'], 'quality.manage': ['Admin'], 'privacy.manage': ['Admin'] },
  },
];
