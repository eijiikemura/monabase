// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
// Starlight's locked dependency tree supplies the YAML parser.
import yaml from 'js-yaml';
const workflow = yaml.load(fs.readFileSync(new URL('../../.github/workflows/website.yml', import.meta.url), 'utf8'));

test('Website builds are read-only and publish only on explicit dispatch in the intended public repository', () => {
  assert.deepEqual(Object.keys(workflow.on), ['push', 'workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.match(workflow.jobs.build.if, /!github.event.repository.fork/);
  assert.match(workflow.jobs.build.if, /github.event.repository.default_branch/);
  assert.equal(workflow.jobs.build.defaults.run['working-directory'], 'website');
  assert.equal(workflow.jobs.deploy.needs, 'build');
  assert.match(workflow.jobs.deploy.if, /github.event_name == 'workflow_dispatch'/);
  assert.match(workflow.jobs.deploy.if, /github.event.repository.visibility == 'public'/);
  assert.match(workflow.jobs.deploy.if, /github.repository == 'eijiikemura\/monabase'/);
  assert.deepEqual(workflow.jobs.deploy.permissions, { pages: 'write', 'id-token': 'write' });
  assert.equal(workflow.jobs.deploy.environment.name, 'github-pages');
  assert.equal(workflow.jobs.deploy.steps.length, 1);
  assert.ok(workflow.jobs.deploy.steps[0].uses.startsWith('actions/deploy-pages@'));
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) {
    if (step.uses) assert.match(step.uses, /^actions\/[\w-]+@[a-f0-9]{40}$/);
    if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
  }
  const upload = workflow.jobs.build.steps.find(step => step.uses?.startsWith('actions/upload-pages-artifact@'));
  assert.equal(upload.with.path, 'website/dist');
  const setup = workflow.jobs.build.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(setup.with['cache-dependency-path'], 'website/package-lock.json');
});
