import { pooledMap } from '$std/async/pool.ts'
import { walk } from '$std/fs/walk.ts'
import { parse } from '$std/path/mod.ts'
import { ensureDir } from '$std/fs/ensure_dir.ts'
import { Entity, ImageMeta } from '@/utilities/photo_constants.ts'
import * as helpers from '@/utilities/photo_helpers.ts'

interface Result {
  entity: Entity
  imageMeta?: { [size: string]: ImageMeta }
  uploadResponse?: Response
  error?: Error
}
const localPath = Deno.args[0]

const COLLECT_IMAGE_META = false
const CONCURRENT = 12

console.log('Fetching FileNames...')

const imageNames = new Set()
for await (
  const dirEntry of walk(localPath, {
    exts: ['png', 'jpg', 'jpeg', 'PNG', 'JPG', 'JPEG'],
    includeDirs: false,
    match: [/.*(\/notes.*)$/],
  })
) {
  const [_, name] = dirEntry?.path?.match(/.*(\/notes.*)$/) || []
  imageNames.add(name)
}
console.log('Images:', imageNames.size)

const entities: Entity[] = Array.from(imageNames)
  .map((fileName) => helpers.createUploadEntities(fileName, localPath)).flat()

const results: AsyncIterableIterator<Result> = await pooledMap(
  CONCURRENT,
  entities,
  async (entity: Entity): Promise<Result> => {
    const result: Result = { entity }
    const { downloadPath, uploadPath } = entity
    try {
      await Deno.lstat(uploadPath)
    } catch {
      try {
        const bufferArr: Uint8Array = await Deno.readFile(downloadPath)
        const imgArray = await helpers.formatBuffer(bufferArr, entity)
        const bytes = typedArrayToBuffer(imgArray)
        await ensureDir(parse(uploadPath).dir)
        await Deno.writeFile(uploadPath, bytes, { createNew: true })
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          result.error = error
        }
      }
    }

    return result
  },
)

let count = 0
const errors: [string, Error][] = []

try {
  for await (const { entity, error, imageMeta } of results) {
    if (error) errors.push([entity.uploadPath, error])
    const status = error ? 'FAILURE' : 'SUCCESS'

    const entityCountDigits = String(entities.length).length
    const countLog = String(++count).padStart(entityCountDigits, '0')
    console.log(`${countLog}/${entities.length} ${status} ${entity.uploadPath}`)
    if (COLLECT_IMAGE_META) console.log(imageMeta)
  }
} catch (e) {
  console.error(e)
}

console.log(errors)

function typedArrayToBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteLength + arr.byteOffset)
}
