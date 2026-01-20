import { describe, it, expect } from 'vitest'
import { Maritaca, createClient } from '../client.js'

describe('Maritaca Client', () => {
  describe('Maritaca class', () => {
    it('should create client instance', () => {
      const client = new Maritaca({
        apiKey: 'test-key',
        baseUrl: 'http://localhost:7377',
      })

      expect(client).toBeDefined()
      expect(client.messages).toBeDefined()
    })

    it('should throw if apiKey is missing', () => {
      expect(() => {
        new Maritaca({
          apiKey: '',
          baseUrl: 'http://localhost:7377',
        })
      }).toThrow('API key is required')
    })

    it('should throw if baseUrl is missing', () => {
      expect(() => {
        new Maritaca({
          apiKey: 'test-key',
          baseUrl: '',
        })
      }).toThrow('Base URL is required')
    })

    it('should remove trailing slash from baseUrl', () => {
      const client = new Maritaca({
        apiKey: 'test-key',
        baseUrl: 'http://localhost:7377/',
      })

      expect(client.messages).toBeDefined()
    })
  })

  describe('createClient', () => {
    it('should create client instance', () => {
      const client = createClient({
        apiKey: 'test-key',
        baseUrl: 'http://localhost:7377',
      })

      expect(client).toBeInstanceOf(Maritaca)
    })
  })
})
