/**
 * Demo material content for the seed.
 *
 * This is fixture text written for the demo, not an extract of a real
 * copyrighted module. It is deliberately plain and factual so the accessible
 * lesson, the citations, and the practice questions all line up sensibly.
 */

export interface SeedTopic {
  id: string;
  slug: string;
  name: string;
  summary: string;
  firstPage: number;
  lastPage: number;
  prerequisiteSlugs: string[];
  /** One entry per page in [firstPage, lastPage]. */
  pages: { heading: string; body: string }[];
}

export const DEMO_MATERIAL = {
  id: 'mat_demo_js',
  title: 'JavaScript Basics — Grade 11 Module',
  filename: 'javascript-basics-grade11.pdf',
  pageCount: 42,
};

export const DEMO_VOCABULARY = [
  {
    tag: 'assignment_vs_comparison',
    label: 'Confusing assignment with comparison',
    description:
      'Using = (which stores a value) where == or === (which compares values) is needed.',
  },
  {
    tag: 'strict_vs_loose_equality',
    label: 'Mixing up == and ===',
    description:
      'Treating loose equality (==) and strict equality (===) as interchangeable, when == converts types first.',
  },
  {
    tag: 'operator_precedence',
    label: 'Getting the order of operators wrong',
    description:
      'Evaluating an expression left to right instead of applying precedence rules.',
  },
  {
    tag: 'truthy_falsy',
    label: 'Misjudging truthy and falsy values',
    description:
      'Assuming a value like 0, "" or [] behaves as true or false when the opposite is the case.',
  },
  {
    tag: 'scope_confusion',
    label: 'Losing track of where a variable exists',
    description:
      'Expecting a variable declared inside a block or function to be visible outside it.',
  },
] as const;

export const DEMO_TOPICS: SeedTopic[] = [
  {
    id: 'topic_variables',
    slug: 'variables',
    name: 'Variables',
    summary:
      'How to store a value under a name using let, const and var, and when each one is appropriate.',
    firstPage: 1,
    lastPage: 5,
    prerequisiteSlugs: [],
    pages: [
      {
        heading: 'What a Variable Is',
        body: `A variable is a named place to keep a value so you can use it again later. In JavaScript you create one with the keyword let, followed by a name, then an equals sign and the value.

let score = 10;

The name is score. The value is 10. From this point on, writing score gives you 10.`,
      },
      {
        heading: 'Declaring with let',
        body: `Use let when the value will change while the program runs.

let attempts = 0;
attempts = 1;
attempts = 2;

Each line after the first assigns a new value. You only write let once, when the variable is first created.`,
      },
      {
        heading: 'Declaring with const',
        body: `Use const when the value must not be reassigned.

const maxAttempts = 3;

Trying to assign a new value to a const causes an error. Choose const by default, and switch to let only when you know the value has to change.`,
      },
      {
        heading: 'Naming Variables',
        body: `A variable name may contain letters, digits, underscores and dollar signs, but it cannot begin with a digit. Names are case sensitive, so score and Score are two different variables.

Good names describe the value: totalMarks is clearer than tm.`,
      },
      {
        heading: 'The Older var Keyword',
        body: `Older code uses var. A var declaration is visible throughout the whole function that contains it, even before the line where it appears. This behaviour causes confusion, so modern code prefers let and const.`,
      },
    ],
  },
  {
    id: 'topic_data_types',
    slug: 'data_types',
    name: 'Data Types',
    summary:
      'The basic kinds of value in JavaScript — numbers, strings, booleans, null and undefined — and how to check which one you have.',
    firstPage: 6,
    lastPage: 10,
    prerequisiteSlugs: ['variables'],
    pages: [
      {
        heading: 'Numbers',
        body: `JavaScript has a single number type. It covers whole numbers and decimals alike.

let count = 7;
let price = 19.95;

Arithmetic uses the symbols +, -, * and /.`,
      },
      {
        heading: 'Strings',
        body: `A string is text. Write it between single quotes, double quotes or backticks.

let name = 'Ana';
let greeting = "Hello";

Backticks allow a value to be inserted directly with the dollar-brace form.`,
      },
      {
        heading: 'Booleans',
        body: `A boolean is either true or false. Booleans are what comparisons produce, and what conditions test.

let passed = true;
let failed = false;`,
      },
      {
        heading: 'null and undefined',
        body: `undefined means a variable has been declared but never given a value. null means it has deliberately been given "no value".

let a;
let b = null;

The variable a is undefined. The variable b is null.`,
      },
      {
        heading: 'Checking a Type',
        body: `The typeof operator reports the type of a value as a string.

typeof 7 gives "number"
typeof 'Ana' gives "string"
typeof true gives "boolean"`,
      },
    ],
  },
  {
    id: 'topic_operators',
    slug: 'operators',
    name: 'Operators',
    summary:
      'Arithmetic, assignment and comparison operators, and the order in which JavaScript applies them.',
    firstPage: 11,
    lastPage: 15,
    prerequisiteSlugs: ['data_types'],
    pages: [
      {
        heading: 'Arithmetic Operators',
        body: `The arithmetic operators are + for addition, - for subtraction, * for multiplication, / for division and % for the remainder.

10 % 3 gives 1, because 3 goes into 10 three times with 1 left over.`,
      },
      {
        heading: 'The Assignment Operator',
        body: `A single equals sign is the assignment operator. It stores the value on the right into the variable on the left.

let total = 5;

This does not ask whether total equals 5. It makes total equal 5.`,
      },
      {
        heading: 'Operator Precedence',
        body: `Multiplication and division are applied before addition and subtraction.

2 + 3 * 4 gives 14, not 20, because 3 * 4 is evaluated first.

Brackets override the order. (2 + 3) * 4 gives 20.`,
      },
      {
        heading: 'Shorthand Assignment',
        body: `The shorthand forms combine arithmetic with assignment.

total += 5 means total = total + 5
total -= 2 means total = total - 2`,
      },
      {
        heading: 'Comparison Operators',
        body: `Comparison operators produce a boolean. They are > greater than, < less than, >= at least, <= at most, === strictly equal and !== strictly not equal.

7 > 3 gives true.`,
      },
    ],
  },
  {
    id: 'topic_conditionals',
    slug: 'conditionals',
    name: 'Conditionals',
    summary:
      'Using if, else if and else to choose between paths, and comparing values correctly with === rather than =.',
    firstPage: 16,
    lastPage: 21,
    prerequisiteSlugs: ['operators'],
    pages: [
      {
        heading: 'The if Statement',
        body: `An if statement runs a block of code only when its condition is true.

if (score > 50) {
  console.log('Pass');
}

The condition sits in brackets. The code to run sits in braces.`,
      },
      {
        heading: 'Comparing Values: = versus ==',
        body: `This is the most common mistake in this chapter.

A single equals sign assigns. A double or triple equals sign compares.

if (score = 50) is wrong. It stores 50 into score and then treats that as the condition.

if (score === 50) is correct. It asks whether score is 50, and produces true or false.`,
      },
      {
        heading: 'Strict and Loose Equality',
        body: `The == operator converts the two values to the same type before comparing. The === operator does not: it requires the same type as well as the same value.

'5' == 5 gives true, because the string is converted to a number.
'5' === 5 gives false, because a string is not a number.

Prefer === so that no hidden conversion happens.`,
      },
      {
        heading: 'else and else if',
        body: `Use else for the case where the condition is false, and else if to test another condition.

if (score >= 75) {
  grade = 'A';
} else if (score >= 50) {
  grade = 'B';
} else {
  grade = 'F';
}

Only the first matching branch runs.`,
      },
      {
        heading: 'Truthy and Falsy Values',
        body: `A condition does not have to be a boolean. JavaScript treats some values as false: 0, the empty string, null, undefined and NaN. Every other value, including the string "0" and an empty array, is treated as true.`,
      },
      {
        heading: 'Logical Operators',
        body: `Combine conditions with && for and, || for or, and ! for not.

if (age >= 13 && age <= 19) tests both conditions at once.`,
      },
    ],
  },
  {
    id: 'topic_loops',
    slug: 'loops',
    name: 'Loops',
    summary: 'Repeating work with for and while loops, and stopping at the right point.',
    firstPage: 22,
    lastPage: 26,
    prerequisiteSlugs: ['conditionals'],
    pages: [
      {
        heading: 'The for Loop',
        body: `A for loop repeats a block a fixed number of times.

for (let i = 0; i < 5; i++) {
  console.log(i);
}

It has three parts: a starting value, a condition to keep going, and a step.`,
      },
      {
        heading: 'Counting from Zero',
        body: `Loops usually start at 0 because positions in a list start at 0. A loop written with i < length runs exactly length times.`,
      },
      {
        heading: 'The while Loop',
        body: `A while loop repeats for as long as its condition stays true.

while (attempts < 3) {
  attempts++;
}

Something inside the loop must eventually make the condition false, or the loop never ends.`,
      },
      {
        heading: 'break and continue',
        body: `break leaves the loop immediately. continue skips the rest of the current pass and starts the next one.`,
      },
      {
        heading: 'Looping Over a List',
        body: `A for loop can visit every item in a list by using the position as an index, from 0 up to one less than the length.`,
      },
    ],
  },
  {
    id: 'topic_functions',
    slug: 'functions',
    name: 'Functions',
    summary:
      'Packaging code under a name so it can be reused, passing values in and returning a result.',
    firstPage: 27,
    lastPage: 32,
    prerequisiteSlugs: ['loops'],
    pages: [
      {
        heading: 'Declaring a Function',
        body: `A function groups statements under a name so they can be run whenever needed.

function greet() {
  console.log('Hello');
}

Writing greet() runs the code inside.`,
      },
      {
        heading: 'Parameters and Arguments',
        body: `A parameter is a name listed in the declaration. An argument is the value supplied when the function is called.

function greet(name) {
  console.log('Hello ' + name);
}

greet('Ana') passes 'Ana' as the argument.`,
      },
      {
        heading: 'Returning a Value',
        body: `The return keyword sends a value back to whoever called the function.

function double(n) {
  return n * 2;
}

let result = double(4);

Now result holds 8. Code written after a return never runs.`,
      },
      {
        heading: 'Function Scope',
        body: `A variable declared inside a function exists only inside that function. Code outside cannot see it.

function count() {
  let total = 0;
}

Using total outside count() causes an error.`,
      },
      {
        heading: 'Arrow Functions',
        body: `An arrow function is a shorter way to write a function.

const double = (n) => n * 2;

When the body is a single expression, its value is returned automatically.`,
      },
      {
        heading: 'Why Functions Matter',
        body: `Functions let you write a piece of logic once and use it in many places. If the logic needs fixing, you fix it in one spot.`,
      },
    ],
  },
  {
    id: 'topic_arrays',
    slug: 'arrays',
    name: 'Arrays',
    summary: 'Storing an ordered list of values and reaching individual items by position.',
    firstPage: 33,
    lastPage: 37,
    prerequisiteSlugs: ['functions'],
    pages: [
      {
        heading: 'Creating an Array',
        body: `An array holds several values in order, written between square brackets.

let marks = [70, 85, 92];`,
      },
      {
        heading: 'Indexes Start at Zero',
        body: `The first item is at position 0.

marks[0] gives 70
marks[1] gives 85

The last item is at position length - 1.`,
      },
      {
        heading: 'Length',
        body: `The length property reports how many items an array holds. For [70, 85, 92], length is 3, and the highest valid index is 2.`,
      },
      {
        heading: 'Adding and Removing',
        body: `push adds an item to the end. pop removes the last item and gives it back.`,
      },
      {
        heading: 'Looping Over an Array',
        body: `A for loop from 0 while i < marks.length visits every item exactly once.`,
      },
    ],
  },
  {
    id: 'topic_objects',
    slug: 'objects',
    name: 'Objects',
    summary: 'Grouping related values together under named keys rather than numbered positions.',
    firstPage: 38,
    lastPage: 42,
    prerequisiteSlugs: ['arrays'],
    pages: [
      {
        heading: 'Creating an Object',
        body: `An object groups related values under names, written between braces.

let student = { name: 'Ana', age: 16 };`,
      },
      {
        heading: 'Reading a Property',
        body: `Use a dot and the property name.

student.name gives 'Ana'

Square brackets also work when the key is held in a variable.`,
      },
      {
        heading: 'Changing a Property',
        body: `Assign to a property to change it, or to add one that did not exist.

student.age = 17;
student.grade = 'A';`,
      },
      {
        heading: 'Objects Inside Arrays',
        body: `A list of records is usually an array of objects, visited with a loop and read with a dot.`,
      },
      {
        heading: 'Objects Compared with Arrays',
        body: `Use an array when order matters and the items are the same kind of thing. Use an object when each value means something different and deserves a name.`,
      },
    ],
  },
];
