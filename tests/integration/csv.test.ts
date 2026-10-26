import { describe, expect, it } from 'vitest'
import { parseStudentRows } from '@/industries/school/components/StudentBulkDialogs'
import { parseCsv, parseCsvObjects } from '@/shared/utilities/csv'

describe('reading CSV', () => {
  it('handles quotes, commas and line breaks inside cells, Windows line ends and a byte-order mark', () => {
    expect(parseCsv('\uFEFFa,b,c\r\n1,"x, y",3\r\n"line\nbreak","say ""hi""",\r\n\r\n')).toEqual([['a', 'b', 'c'], ['1', 'x, y', '3'], ['line\nbreak', 'say "hi"', '']])
  })
  it('keys each row by a tidied header', () => {
    expect(parseCsvObjects('First Name,Date of Birth\nAda,2018-05-01').rows).toEqual([{ first_name: 'Ada', date_of_birth: '2018-05-01' }])
  })
})

describe('checking student rows', () => {
  const classes = [{ id: 'c1', name: 'Primary 1' }, { id: 'c2', name: 'JSS 1' }]
  const csv = [
    'first_name,last_name,gender,date_of_birth,class,guardian_name,guardian_phone,guardian_email',
    'Ada,Obi,F,2018-05-01,primary 1,Mrs Obi,0803,obi@example.com',
    'Bayo,,male,,,,,',
    'Chidi,Eze,boy,,,,,',
    'Dayo,Ade,male,01/05/2018,,,,',
    'Efe,Ojo,male,,Primary 9,,,',
    'Femi,Ola,male,2999-01-01,,,,',
    'Gina,Uche,female,,,,0809,',
    'Hope,Eke,female,,JSS 1,Mr Eke,,not-an-email',
    'Ivy,Nne,,,,,,',
  ].join('\n')
  const { rows, missing } = parseStudentRows(csv, classes)

  it('accepts good rows, tidying the gender and finding the class by name in any case', () => {
    expect(missing).toEqual([])
    expect(rows[0].error).toBeNull()
    expect(rows[0].input).toMatchObject({ first: 'Ada', last: 'Obi', gender: 'female', classId: 'c1', dob: '2018-05-01' })
    expect(rows[0].guardian).toMatchObject({ name: 'Mrs Obi', phone: '0803', email: 'obi@example.com', relationship: 'parent', primary: true })
    expect(rows[8].error).toBeNull(); expect(rows[8].input!.classId).toBeNull() // no class is allowed
  })

  it('says exactly what is wrong with each bad row, and carries on with the rest', () => {
    expect(rows.map((r) => r.error)).toEqual([null, 'first and last name are needed', 'gender must be male or female', 'date of birth must look like 2018-05-01 and not be in the future', 'there is no open class called "Primary 9"', 'date of birth must look like 2018-05-01 and not be in the future', "a parent's phone or email needs the parent's name", "the parent's email does not look right", null])
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('reports a missing required column', () => {
    expect(parseStudentRows('name,class\nAda,Primary 1', classes).missing).toEqual(['first_name', 'last_name'])
  })
})
