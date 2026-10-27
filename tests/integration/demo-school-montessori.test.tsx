import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { getIndustry } from '@/core/industry-registry'
import { ProgressReportSheet } from '@/industries/school/components/ProgressReportSheet'
import * as sc from '@/demo/demoSchool'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let biz: string, ch: string, ada: string, cyril: string, term: string
const names = (b: string) => sc.demoStructure(b).classes.map((c) => c.name)
const workId = (area: string, name: string) => { const sub = sc.demoStructure(biz).subjects.find((x) => x.name === area)!; return sc.demoWorks(biz).find((w) => w.subjectId === sub.id && w.name === name)!.id }

beforeAll(async () => {
  as('owner@demo.test')
  biz = demoCreateBusiness('Little Hands Montessori', 'school')
  await getIndustry('school').afterCreate!(biz, { school_type: 'montessori', session_name: '2026/2027' })
  const st = sc.demoStructure(biz)
  ch = st.classes.find((c) => c.name === "Children's House")!.id
  const lower = st.classes.find((c) => c.name === 'Lower Elementary')!.id
  term = st.terms[0].id
  const reg = (first: string, cls: string) => {
    expect(sc.demoRegisterStudent(biz, { first, middle: '', last: 'Child', dob: '', gender: '', classId: cls, admittedOn: '2026-09-01', emergencyName: '', emergencyPhone: '', notes: '' }, [], `key-${first}-abcdefgh`).error).toBeNull()
    return sc.demoStudents(biz).find((x) => x.first === first)!.id
  }
  ada = reg('Ada', ch); cyril = reg('Cyril', lower)
})

describe('a Montessori school in the demo', () => {
  it('starts with the four environments and their ages, the curriculum areas and the standard works', () => {
    expect(names(biz).sort()).toEqual(["Children's House", 'Lower Elementary', 'Toddler Community', 'Upper Elementary'])
    expect(sc.demoStructure(biz).classes.find((c) => c.name === "Children's House")!.description).toBe('Ages 3 to 6 years')
    expect(sc.demoStructure(biz).subjects.map((x) => x.name).sort()).toEqual(['Art and Music', 'Cultural Studies', 'Grace and Courtesy', 'Language', 'Mathematics', 'Practical Life', 'Sensorial'])
    expect(sc.demoStructure(biz).departments).toEqual([])
    expect(sc.demoWorks(biz).length).toBeGreaterThan(80)
  })

  it('is its own kind: other stages are refused, and "all" never includes Montessori', async () => {
    expect(sc.demoSaveClass(biz, { id: null, name: 'Primary 1', levelOrder: 3, arm: '', active: true, stage: 'primary' })).toMatch(/cannot have primary classes/)
    const all = demoCreateBusiness('Everything', 'school')
    await getIndustry('school').afterCreate!(all, { school_type: 'combined', session_name: '2026/2027' })
    expect(sc.demoStructure(all).classes.some((c) => c.stage === 'montessori')).toBe(false)
    expect(sc.demoSaveClass(all, { id: null, name: 'Stray', levelOrder: 1, arm: '', active: true, stage: 'montessori' })).toMatch(/cannot have montessori environments/)
    as('owner@demo.test')
  })

  it('records progress, moves it along, clears it, and checks what it is given', () => {
    const w = workId('Practical Life', 'Pouring water')
    expect(sc.demoRecordProgress(biz, w, [{ studentId: ada, status: 'introduced' }, { studentId: cyril, status: 'practising', note: 'Getting steadier' }])).toBeNull()
    expect(sc.demoProgress(biz).filter((p) => p.workId === w).map((p) => p.status).sort()).toEqual(['introduced', 'practising'])
    expect(sc.demoRecordProgress(biz, w, [{ studentId: ada, status: 'mastered' }])).toBeNull()
    expect(sc.demoProgress(biz).find((p) => p.studentId === ada && p.workId === w)!.status).toBe('mastered')
    expect(sc.demoRecordProgress(biz, w, [{ studentId: ada, status: null }])).toBeNull()
    expect(sc.demoProgress(biz).some((p) => p.studentId === ada && p.workId === w)).toBe(false)
    expect(sc.demoRecordProgress(biz, w, [{ studentId: ada, status: 'expert' as sc.ProgressStatus }])).toMatch(/introduced, practising or mastered/)
    expect(sc.demoRecordProgress(biz, w, [])).toMatch(/choose the children/)
  })

  it('changes the works of an area (managers only), keeping progress on the works that stay', () => {
    const sub = sc.demoStructure(biz).subjects.find((x) => x.name === 'Language')!.id
    const sp = workId('Language', 'Sandpaper letters')
    sc.demoRecordProgress(biz, sp, [{ studentId: ada, status: 'introduced' }])
    as('teacher@demo.test')
    expect(sc.demoSaveWorks(biz, sub, ['x'])).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(sc.demoSaveWorks(biz, sub, ['Sandpaper letters', 'Phonogram work', ' ', 'Reading books'])).toBeNull()
    expect(sc.demoWorks(biz).filter((w) => w.subjectId === sub).map((w) => w.name)).toEqual(['Sandpaper letters', 'Phonogram work', 'Reading books'])
    expect(sc.demoProgress(biz).some((p) => p.studentId === ada && p.workId === sp)).toBe(true)
  })

  it('builds the progress report with each area, where the child is, the guide note and the age range', () => {
    const pl = sc.demoStructure(biz).subjects.find((x) => x.name === 'Practical Life')!.id
    sc.demoRecordProgress(biz, workId('Practical Life', 'Spooning'), [{ studentId: ada, status: 'mastered' }])
    expect(sc.demoSaveProgressNote(biz, ada, term, pl, 'Works with great care.')).toBeNull()
    const r = sc.demoProgressReport(biz, ada, term)
    expect(r.student).toMatchObject({ name: 'Ada Child', class: "Children's House", age: 'Ages 3 to 6 years' })
    expect(r.areas.map((a) => a.subject)).toEqual(['Art and Music', 'Cultural Studies', 'Grace and Courtesy', 'Language', 'Mathematics', 'Practical Life', 'Sensorial'])
    const area = r.areas.find((a) => a.subject === 'Practical Life')!
    expect(area.note).toBe('Works with great care.')
    expect(area.works.find((w) => w.name === 'Spooning')!.status).toBe('mastered')
    expect(area.works.find((w) => w.name === 'Lacing')!.status).toBeNull()
    expect(sc.demoSaveProgressNote(biz, ada, term, pl, '')).toBeNull()
    expect(sc.demoProgressReport(biz, ada, term).areas.find((a) => a.subject === 'Practical Life')!.note).toBeNull()
  })

  it('prints as a designed progress report with no marks, grades or positions', () => {
    sc.demoRecordProgress(biz, workId('Practical Life', 'Spooning'), [{ studentId: ada, status: 'mastered' }])
    const html = renderToStaticMarkup(<ProgressReportSheet report={sc.demoProgressReport(biz, ada, term)} />)
    for (const text of ['Progress report', 'Little Hands Montessori', 'Ada Child', '3 to 6 years', 'Practical Life', 'Sensorial', 'Mastered', 'overall comment', 'Key:']) expect(html).toContain(text)
    for (const word of ['Position', 'Class avg', 'Grading key']) expect(html).not.toContain(word)
  })

  it('goes with the child when the child is deleted, and with the area when the area is deleted', () => {
    sc.demoRecordProgress(biz, workId('Sensorial', 'Red rods'), [{ studentId: cyril, status: 'introduced' }])
    expect(sc.demoDeleteStudent(biz, cyril, 'Entered twice by mistake')).toBeNull()
    expect(sc.demoProgress(biz).some((p) => p.studentId === cyril)).toBe(false)
    const art = sc.demoStructure(biz).subjects.find((x) => x.name === 'Art and Music')!.id
    expect(sc.demoDeleteSubject(biz, art)).toBeNull()
    expect(sc.demoWorks(biz).some((x) => x.subjectId === art)).toBe(false)
  })

  it('switches to and from Montessori, adding and removing the environments, areas and works', async () => {
    as('owner@demo.test')
    const b = demoCreateBusiness('Switcher', 'school')
    await getIndustry('school').afterCreate!(b, { school_type: 'primary', session_name: '2026/2027' })
    const save = (type: sc.SSettings['schoolType']) => sc.demoSaveSettings(b, { schoolType: type, address: '', phone: '', email: '', caMax: 40, examMax: 60, showPosition: false, workingDays: [1, 2, 3, 4, 5] })
    expect(save('montessori')).toBeNull()
    expect(names(b).sort()).toEqual(["Children's House", 'Lower Elementary', 'Toddler Community', 'Upper Elementary'])
    expect(sc.demoWorks(b).length).toBeGreaterThan(80)
    expect(save('primary')).toBeNull()
    expect(names(b)).toEqual(['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'])
    expect(sc.demoWorks(b)).toEqual([])
  })
})
