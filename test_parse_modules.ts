import { CourseTreeProvider } from './src/courseTreeProvider'

// Create a test YAML string to see how it parses
const testYaml = `modules:
  - name: "Week 1: Foundation & Setup"
    published: true
    items:
      - type: page
        page_url: "week-1-intro"
        title: "Week 1 Introduction"
      - type: page
        page_url: "week-1-setup"
        title: "Setup Instructions"
`

// Access the private parseModulesYaml method through any type casting
const provider = new CourseTreeProvider({} as any)
const result = (provider as any).parseModulesYaml(testYaml)
console.log('Parsed modules:', JSON.stringify(result, null, 2))
