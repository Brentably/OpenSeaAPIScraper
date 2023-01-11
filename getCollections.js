import fetch from 'node-fetch'
import fs from 'fs'

function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time))
}

const MNEMONIC_KEY = 'IXegSINDczttZYQCW71r7esUNpuK9y6P2B3WexEV2bogvTgg'
const OPENSEA_KEY = '3e5b9d40eaf64147882619dc07d7d50a'

async function run() {
  async function batch500(num) {
  let offset = (num * 500).toString()
  const query = new URLSearchParams({
    limit: '500',
    offset: offset,
    duration: 'DURATION_30_DAYS',
  }).toString()

  const resp = await fetch(`https://ethereum.rest.mnemonichq.com/collections/v1beta1/top/by_sales_volume?${query}`, {
    method: 'GET',
    headers: {
      'X-API-Key': MNEMONIC_KEY,
    },
  })
  if (!resp.ok) console.log('ERROR' + resp.status)

  const data = await resp.json()
  // console.log(data)

  const addData = async (collections) => {
    //this function takes in a an array of collections, iterates over it, finding the slug from the contract address with an API call, and then finding the floor price with the slug, and then adding that floor price to each collection in the array, altering the array it took in
    let lastCalledOpenSea = null
    const rateLimitOpenSea = async () => {
      const rateLimit = 400
      //rate limits opensea, but could easily be adapted for other API's. Max Rate is 4 calls a second, so 250ms or just 250
      const ct = Date.now()
      const timeElapsed = ct - lastCalledOpenSea
      if (timeElapsed < rateLimit) {
        await delay(rateLimit - timeElapsed)
      }

      lastCalledOpenSea = Date.now()
    }

    const getInfoFromAddress = async (address) => {
      await rateLimitOpenSea()
      //this function takes a contract address, calls the OpenSea api to determine the collection slug, twitter username, etc.
      const options = { method: 'GET', headers: { 'X-API-KEY': OPENSEA_KEY } }
      const response = await fetch(`https://api.opensea.io/api/v1/asset_contract/${address}`, options)
      if (!response.ok) console.log('ERROR on function getSlugFromAddress' + response.status)

      const data = await response.json()

      if(!data.collection) return {slug: null, twitter_username: null}
      return { slug: data.collection.slug, twitter_username: data.collection.twitter_username }
    }

    const getInfoFromSlug = async (slug) => {
      await rateLimitOpenSea()
      //this function takes in a slug, calls the opensea API and returns the floorprice  of the collection associated with that slug, and if its bunk
      const options = { method: 'GET', headers: { 'X-API-KEY': OPENSEA_KEY } }
      const response = await fetch(`https://api.opensea.io/api/v1/collection/${slug}`, options)

      //ERROR HANDLING
      if (!response.ok && response.status != 404) {
        console.error(`ERROR on function getInfoFromSlug: ${response.status} Here's the body of the response:`)
        console.dir(response.body)
      }
      if (response.status == 404) return { floorPrice: 'N/A', bunk: true } //opensea only returns a 404 error if the collection has been removed from opensea for some reason, in which case it's bunk imo


      const data = await response.json()
      // console.log(data)
      //FILTERING SECTION: if it doesn't meet requirements, it's set to bunk and filtered out later. 
      let DAO = false
      let {name, description} = data.collection
      if(name == null || description == null || slug == null) return { floorPrice: 'N/A', bunk: true } //not perfect because it filters out a collection which might have 'DAO' in the name but no description on OpenSea, but I don't really care b/c that's pretty hacky anyway

      let lowercaseName = name.toLowerCase()
      let lowercaseDescription = description.toLowerCase()
      if(lowercaseDescription.includes('tool') || lowercaseName.includes('tool') || slug.includes('tool')) DAO = true



      return { floorPrice: data.collection.stats.floor_price, bunk: !DAO }
    }

    let counter = 0
    for (let collection of collections) {
      counter++
      console.log(`working on collection ${counter} out of ${collections.length} on set ${num}`)


      const { slug: slug, twitter_username: twitter_username } = await getInfoFromAddress(collection.contractAddress)

      //set the floor price and add info
      collection.openseaLink = `https://opensea.io/collection/${slug}`
      collection.slug = slug
      collection.twitterLink = twitter_username ? `https://twitter.com/${twitter_username}` : 'N/A'
      // await delay(250) // waiting a quarter of a second
      const slugInfo = await getInfoFromSlug(slug)
      collection.floorPrice = slugInfo.floorPrice
      collection.bunk = slugInfo.bunk

      //@notes Object spread operator does NOT work here, because it basically sets collection = this new collection object but never points the the data to the right spot collection.slug for instance actually goes to where that spot is in memory and writes it. Annoying coding nuance
      // collection = {
      //   ...collection,
      //   openseaLink: `https://opensea.io/collection/${slug}`,
      //   slug: slug,
      //   twitterLink: `https://twitter.com/${twitter_username}`,
      //   floorPrice: await getFloorPriceFromSlug(slug),
      // }
    }
    // console.log(collections)
    return collections
  }
  const collectionsWithFloorPrices = await addData(data.collections)

  //last step filters the collections, removes those that have less than a 0.1 floor price , and maps the data schema to one that will be more liked by Notion
  const refined = collectionsWithFloorPrices
    .filter((collection) => {
      //want to filter it so that it meets the measurable criteria and only returns true if it meets this criteria. floorprice has to be above a certain point, and bunk has to be false
      // return collection.floorPrice >= 0.1 && !collection.bunk
      return !collection.bunk
    })
    .map((collection) => {
      let newCollection = {
        Title: collection.contractName,
        Opensea: collection.openseaLink,
        Twitter: collection.twitterLink,
        Type: "tools",
        monthlyVolume: collection.salesVolume.substring(0, 4), //this is from mnemonic
      }
      return newCollection
    })

  console.log(
    `${data.collections.length - refined.length} out of ${data.collections.length} collections were cut from the dataset`
  )
  const final = refined
  // console.log(final)
  

  fs.appendFile(`./compiled.json`, JSON.stringify(final), function (err) {
    if (err) throw err
    console.log('File is created successfully.')
  })
}
await batch500(0)
await batch500(1)
await batch500(2)
await batch500(3)
await batch500(4)



}

run()
