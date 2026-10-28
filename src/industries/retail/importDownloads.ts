import { downloadCsv } from '@/shared/utilities/csvExport'
import { categoryTemplateRows, productTemplateRows } from './importLogic'

/** The two template files, as a download. The example rows in them are skipped on import. */
export const downloadProductTemplate = () => downloadCsv('products-import-template.csv', productTemplateRows())
export const downloadCategoryTemplate = () => downloadCsv('categories-import-template.csv', categoryTemplateRows())
