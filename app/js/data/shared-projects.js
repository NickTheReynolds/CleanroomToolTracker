// @ts-check
/**
 * Projects that come with the app (2.2): backup files under app/projects/,
 * each holding one project with its wafers and plan, ready to add to this
 * device from Settings → Backup and data. They are the app's own files, so
 * they load offline, and they merge like any import: adding one twice
 * changes nothing, and a project the person then edits keeps their edits
 * (the newer version wins). The same files can be imported by hand.
 */

/**
 * @typedef {Object} SharedProject
 * @property {string} id the project record's id, fixed in the file
 * @property {string} file the backup file under app/projects/
 * @property {string} name the project's name
 * @property {string} about one sentence on what it is
 */

/** @type {readonly SharedProject[]} */
export const SHARED_PROJECTS = Object.freeze([
  {
    id: '7d3f6a2e-9b41-4c58-8e2a-5f0c1d9e4b72',
    file: 'nrr_regjig_v9_1.json',
    name: 'nrr_regjig_v9_1',
    about: 'Registration-jig sweep v9: 25 steps on 100 mm DSP Si, from the RCA clean and wet oxide to the cleave, with the µPG 501 layers 1/0 and 2/0 and two Pegasus Recipe 3 runs (375 µm blind, then through).',
  },
]);
