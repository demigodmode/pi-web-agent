# Why is conditional processing of a sorted array faster than of an unsorted array?

https://stackoverflow.com/questions/11227809

In this C++ code, sorting the data (before the timed region) makes the primary loop ~6x faster:
#include <algorithm>
#include <ctime>
#include <iostream>
int main()
{
    // Generate data
    const unsigned arraySize = 32768;
    int data[arraySize];
    for (unsigned c = 0; c < arraySize; ++c)
        data[c] = std::rand() % 256;
    // !!! With this, the next loop runs faster.
    std::sort(data, data + arraySize);
    // Test
    clock_t start = clock();
    long long sum = 0;
    for (unsigned i = 0; i < 100000; ++i)
    {
        for (unsigned c = 0; c < arraySize; ++c)
        {   // Primary loop.
            if (data[c] >= 128)
                sum += data[c];
        }
    }
    double elapsedTime = static_cast<double>(clock()-start) / CLOCKS_PER_SEC;
    std::cout << elapsedTime << '\n';
    std::cout << "sum = " << sum << '\n';
}
Without std::sort(data, data + arraySize);, the code runs in 11.54 seconds.
With the sorted data, the code runs in 1.93 seconds.
(Sorting itself takes more time than this one pass over the array, so it's not actually worth doing if we needed to calculate this for an unknown array.)
Initially, I thought this might be just a language or compiler anomaly, so I tried Java:
import java.util.Arrays;
import java.util.Random;
public class Main
{
    public static void main(String[] args)
    {
        // Generate data
        int arraySize = 32768;
        int data[] = new int[arraySize];
        Random rnd = new Random(0);
        for (int c = 0; c < arraySize; ++c)
            data[c] = rnd.nextInt() % 256;
        // !!! With this, the next loop runs faster
        Arrays.sort(data);
        // Test
        long start = System.nanoTime();
        long sum = 0;
        for (int i = 0; i < 100000; ++i)
        {
            for (int c = 0; c < arraySize; ++c)
            {   // Primary loop.
                if (data[c] >= 128)
                    sum += data[c];
            }
        }
        System.out.println((System.nanoTime() - start) / 1000000000.0);
        System.out.println("sum = " + sum);
    }
}
With a similar but less extreme result.
My first thought was that sorting brings the data into the cache, but that's silly because the array was just generated.
What is going on?
Why is processing a sorted array faster than processing an unsorted array?
The code is summing up some independent terms, so the order should not matter.
Related / follow-up Q&As with more modern C++ compilers
Why is processing an unsorted array the same speed as processing a sorted array with modern x86-64 clang? - modern C++ compilers auto-vectorize the loop, especially when SSE4.1 or AVX2 is available.  This avoids any data-dependent branching so performance isn't data-dependent.
gcc optimization flag -O3 makes code slower than -O2 - branchless scalar with cmov can result in a longer dependency chain (especially when GCC chooses poorly), creating a latency bottleneck that makes it slower than branchy asm for the sorted case.


---

Score 35296

You are a victim of branch prediction fail.
What is Branch Prediction?
Consider a railroad junction:
Image by Mecanismo, via Wikimedia Commons. Used under the CC-By-SA 3.0 license.
Now for the sake of argument, suppose this is back in the 1800s - before long-distance or radio communication.
You are a blind operator of a junction and you hear a train coming. You have no idea which way it is supposed to go. You stop the train to ask the driver which direction they want. And then you set the switch appropriately.
Trains are heavy and have a lot of inertia, so they take forever to start up and slow down.
Is there a better way? You guess which direction the train will go!
If you guessed right, it continues on.
If you guessed wrong, the driver will stop, back up, and yell at you to flip the switch. Then it can restart down the other path.
If you guess right every time, the train will never have to stop.
If you guess wrong too often, the train will spend a lot of time stopping, backing up, and restarting.
Consider an if-statement: At the processor level, it is a branch instruction:
You are a processor and you see a branch. You have no idea which way it will go. What do you do? You halt execution and wait until the previous instructions are complete. Then you continue down the correct path.
Modern processors are complicated and have long pipelines. This means they take forever to "warm up" and "slow down".
Is there a better way? You guess which direction the branch will go!
If you guessed right, you continue executing.
If you guessed wrong, you need to flush the pipeline and roll back to the branch. Then you can restart down the other path.
If you guess right every time, the execution will never have to stop.
If you guess wrong too often, you spend a lot of time stalling, rolling back, and restarting.
This is branch prediction. I admit it's not the best analogy since the train could just signal the direction with a flag. But in computers, the processor doesn't know which direction a branch will go until the last moment.
How would you strategically guess to minimize the number of times that the train must back up and go down the other path? You look at the past history! If the train goes left 99% of the time, then you guess left. If it alternates, then you alternate your guesses. If it goes one way every three times, you guess the same...
In other words, you try to identify a pattern and follow it. This is more or less how branch predictors work.
Most applications have well-behaved branches. Therefore, modern branch predictors will typically achieve >90% hit rates. But when faced with unpredictable branches with no recognizable patterns, branch predictors are virtually useless.
Further reading: "Branch predictor" article on Wikipedia.
As hinted from above, the culprit is this if-statement:
if (data[c] >= 128)
    sum += data[c];
Notice that the data is evenly distributed between 0 and 255. When the data is sorted, roughly the first half of the iterations will not enter the if-statement. After that, they will all enter the if-statement.
This is very friendly to the branch predictor since the branch consecutively goes the same direction many times. Even a simple saturating counter will correctly predict the branch except for the few iterations after it switches direction.
Quick visualization:
T = branch taken
N = branch not taken
data[] = 0, 1, 2, 3, 4, ... 126, 127, 128, 129, 130, ... 250, 251, 252, ...
branch = N  N  N  N  N  ...   N    N    T    T    T  ...   T    T    T  ...
       = NNNNNNNNNNNN ... NNNNNNNTTTTTTTTT ... TTTTTTTTTT  (easy to predict)
However, when the data is completely random, the branch predictor is rendered useless, because it can't predict random data. Thus there will probably be around 50% misprediction (no better than random guessing).
data[] = 226, 185, 125, 158, 198, 144, 217, 79, 202, 118,  14, 150, 177, 182, ...
branch =   T,   T,   N,   T,   T,   T,   T,  N,   T,   N,   N,   T,   T,   T  ...
       = TTNTTTTNTNNTTT ...   (completely random - impossible to predict)
What can be done?
If the compiler isn't able to optimize the branch into a conditional move, you can try some hacks if you are willing to sacrifice readability for performance.
Replace:
if (data[c] >= 128)
    sum += data[c];
with:
int t = (data[c] - 128) >> 31;
sum += ~t & data[c];
This eliminates the branch and replaces it with some bitwise operations.
(Note that this hack is not strictly equivalent to the original if-statement. But in this case, it's valid for all the input values of data[].)
Benchmarks: Core i7 920 @ 3.5 GHz
C++ - Visual Studio 2010 - x64 Release
Scenario
Time (seconds)
Branching - Random data
11.777
Branching - Sorted data
2.352
Branchless - Random data
2.564
Branchless - Sorted data
2.587
Java - NetBeans 7.1.1 JDK 7 - x64
Scenario
Time (seconds)
Branching - Random data
10.93293813
Branching - Sorted data
5.643797077
Branchless - Random data
3.113581453
Branchless - Sorted data
3.186068823
Observations:
With the Branch: There is a huge difference between the sorted and unsorted data.
With the Hack: There is no difference between sorted and unsorted data.
In the C++ case, the hack is actually a tad slower than with the branch when the data is sorted.
A general rule of thumb is to avoid data-dependent branching in critical loops (such as in this example).
Update:
GCC 4.6.1 with -O3 or -ftree-vectorize on x64 is able to generate a conditional move, so there is no difference between the sorted and unsorted data - both are fast.  This is called "if-conversion" (to branchless) and is necessary for vectorization but also sometimes good for scalar.
(Or somewhat fast: for the already-sorted case, cmov can be slower especially if GCC puts it on the critical path instead of just add, especially on Intel before Broadwell where cmov has 2-cycle latency: gcc optimization flag -O3 makes code slower than -O2)
VC++ 2010 is unable to generate conditional moves for this branch even under /Ox.
Intel C++ Compiler (ICC) 11 does something miraculous. It interchanges the two loops, thereby hoisting the unpredictable branch to the outer loop. Not only is it immune to the mispredictions, it's also twice as fast as whatever VC++ and GCC can generate! In other words, ICC took advantage of the test-loop to defeat the benchmark...
If you give the Intel compiler the branchless code, it just outright vectorizes it... and is just as fast as with the branch (with the loop interchange).
Clang also vectorizes the if() version, as will GCC 5 and later with -O3, even though it takes quite a few instructions to sign-extend to the 64-bit sum on x86 without SSE4 or AVX2.  (-march=x86-64-v2 or v3).  See Why is processing an unsorted array the same speed as processing a sorted array with modern x86-64 clang?
This goes to show that even mature modern compilers can vary wildly in their ability to optimize code...


---

Score 4767

Branch prediction.
With a sorted array, the condition data[c] >= 128 is first false for a streak of values, then becomes true for all later values. That's easy to predict. With an unsorted array, you pay for the branching cost.


---

Score 3860

The reason why performance improves drastically when the data is sorted is that the branch prediction penalty is removed, as explained beautifully in Mysticial's answer.
Now, if we look at the code
if (data[c] >= 128)
    sum += data[c];
we can find that the meaning of this particular if... else... branch is to add something when a condition is satisfied. This type of branch can be easily transformed into a conditional move statement, which would be compiled into a conditional move instruction: cmovl, in an x86 system. The branch and thus the potential branch prediction penalty is removed.
In C, thus C++, the statement, which would compile directly (without any optimization) into the conditional move instruction in x86, is the ternary operator ... ? ... : .... So we rewrite the above statement into an equivalent one:
sum += data[c] >=128 ? data[c] : 0;
While maintaining readability, we can check the speedup factor.
On an Intel Core i7-2600K @ 3.4 GHz and Visual Studio 2010 Release Mode, the benchmark is:
x86
Scenario
Time (seconds)
Branching - Random data
8.885
Branching - Sorted data
1.528
Branchless - Random data
3.716
Branchless - Sorted data
3.71
x64
Scenario
Time (seconds)
Branching - Random data
11.302
Branching - Sorted data
1.830
Branchless - Random data
2.736
Branchless - Sorted data
2.737
The result is robust in multiple tests. We get a great speedup when the branch result is unpredictable, but we suffer a little bit when it is predictable. In fact, when using a conditional move, the performance is the same regardless of the data pattern.
Now let's look more closely by investigating the x86 assembly they generate. For simplicity, we use two functions max1 and max2.
max1 uses the conditional branch if... else ...:
int max1(int a, int b) {
    if (a > b)
        return a;
    else
        return b;
}
max2 uses the ternary operator ... ? ... : ...:
int max2(int a, int b) {
    return a > b ? a : b;
}
On an x86-64 machine, GCC -S generates the assembly below.
:max1
    movl    %edi, -4(%rbp)
    movl    %esi, -8(%rbp)
    movl    -4(%rbp), %eax
    cmpl    -8(%rbp), %eax
    jle     .L2
    movl    -4(%rbp), %eax
    movl    %eax, -12(%rbp)
    jmp     .L4
.L2:
    movl    -8(%rbp), %eax
    movl    %eax, -12(%rbp)
.L4:
    movl    -12(%rbp), %eax
    leave
    ret
:max2
    movl    %edi, -4(%rbp)
    movl    %esi, -8(%rbp)
    movl    -4(%rbp), %eax
    cmpl    %eax, -8(%rbp)
    cmovge  -8(%rbp), %eax
    leave
    ret
max2 uses much less code due to the usage of instruction cmovge. But the real gain is that max2 does not involve branch jumps, jmp, which would have a significant performance penalty if the predicted result is not right.
So why does a conditional move perform better?
In a typical x86 processor, the execution of an instruction is divided into several stages. Roughly, we have different hardware to deal with different stages. So we do not have to wait for one instruction to finish to start a new one. This is called pipelining.
In a branch case, the following instruction is determined by the preceding one, so we cannot do pipelining. We have to either wait or predict.
In a conditional move case, the execution of conditional move instruction is divided into several stages, but the earlier stages like Fetch and Decode do not depend on the result of the previous instruction; only the latter stages need the result. Thus, we wait a fraction of one instruction's execution time. This is why the conditional move version is slower than the branch when the prediction is easy.
The book Computer Systems: A Programmer's Perspective, second edition explains this in detail. You can check Section 3.6.6 for Conditional Move Instructions, entire Chapter 4 for Processor Architecture, and Section 5.11.2 for special treatment for Branch Prediction and Misprediction Penalties.
Sometimes, some modern compilers can optimize our code to assembly with better performance, and sometimes some compilers can't (the code in question is using Visual Studio's native compiler). Knowing the performance difference between a branch and a conditional move when unpredictable can help us write code with better performance when the scenario gets so complex that the compiler can not optimize them automatically.


---

Score 2672

If you are curious about even more optimizations that can be done to this code, consider this:
Starting with the original loop:
for (unsigned i = 0; i < 100000; ++i)
{
    for (unsigned j = 0; j < arraySize; ++j)
    {
        if (data[j] >= 128)
            sum += data[j];
    }
}
With loop interchange, we can safely change this loop to:
for (unsigned j = 0; j < arraySize; ++j)
{
    for (unsigned i = 0; i < 100000; ++i)
    {
        if (data[j] >= 128)
            sum += data[j];
    }
}
Then, you can see that the if conditional is constant throughout the execution of the i loop, so you can hoist the if out:
 for (unsigned j = 0; j < arraySize; ++j)
 {
     if (data[j] >= 128)
     {
         for (unsigned i = 0; i < 100000; ++i)
         {
             sum += data[j];
         }
    }
}
Then, you see that the inner loop can be collapsed into one single expression, assuming the floating point model allows it (/fp:fast is thrown, for example)
for (unsigned j = 0; j < arraySize; ++j)
{
    if (data[j] >= 128)
    {
        sum += data[j] * 100000;
    }
}
That one is 100,000 times faster than before.


---

Score 2214

No doubt some of us would be interested in ways of identifying code that is problematic for the CPU's branch-predictor. The Valgrind tool cachegrind has a branch-predictor simulator, enabled by using the --branch-sim=yes flag. Running it over the examples in this question, with the number of outer loops reduced to 10000 and compiled with g++, gives these results:
Sorted:
==32551== Branches:        656,645,130  (  656,609,208 cond +    35,922 ind)
==32551== Mispredicts:         169,556  (      169,095 cond +       461 ind)
==32551== Mispred rate:            0.0% (          0.0%     +       1.2%   )
Unsorted:
==32555== Branches:        655,996,082  (  655,960,160 cond +  35,922 ind)
==32555== Mispredicts:     164,073,152  (  164,072,692 cond +     460 ind)
==32555== Mispred rate:           25.0% (         25.0%     +     1.2%   )
Drilling down into the line-by-line output produced by cg_annotate we see for the loop in question:
Sorted:
          Bc    Bcm Bi Bim
      10,001      4  0   0      for (unsigned i = 0; i < 10000; ++i)
           .      .  .   .      {
           .      .  .   .          // primary loop
 327,690,000 10,016  0   0          for (unsigned c = 0; c < arraySize; ++c)
           .      .  .   .          {
 327,680,000 10,006  0   0              if (data[c] >= 128)
           0      0  0   0                  sum += data[c];
           .      .  .   .          }
           .      .  .   .      }
Unsorted:
          Bc         Bcm Bi Bim
      10,001           4  0   0      for (unsigned i = 0; i < 10000; ++i)
           .           .  .   .      {
           .           .  .   .          // primary loop
 327,690,000      10,038  0   0          for (unsigned c = 0; c < arraySize; ++c)
           .           .  .   .          {
 327,680,000 164,050,007  0   0              if (data[c] >= 128)
           0           0  0   0                  sum += data[c];
           .           .  .   .          }
           .           .  .   .      }
This lets you easily identify the problematic line - in the unsorted version the if (data[c] >= 128) line is causing 164,050,007 mispredicted conditional branches (Bcm) under cachegrind's branch-predictor model, whereas it's only causing 10,006 in the sorted version.
Alternatively, on Linux you can use the performance counters subsystem to accomplish the same task, but with native performance using CPU counters.
perf stat ./sumtest_sorted
Sorted:
 Performance counter stats for './sumtest_sorted':
  11808.095776 task-clock                #    0.998 CPUs utilized
         1,062 context-switches          #    0.090 K/sec
            14 CPU-migrations            #    0.001 K/sec
           337 page-faults               #    0.029 K/sec
26,487,882,764 cycles                    #    2.243 GHz
41,025,654,322 instructions              #    1.55  insns per cycle
 6,558,871,379 branches                  #  555.455 M/sec
       567,204 branch-misses             #    0.01% of all branches
  11.827228330 seconds time elapsed
Unsorted:
 Performance counter stats for './sumtest_unsorted':
  28877.954344 task-clock                #    0.998 CPUs utilized
         2,584 context-switches          #    0.089 K/sec
            18 CPU-migrations            #    0.001 K/sec
           335 page-faults               #    0.012 K/sec
65,076,127,595 cycles                    #    2.253 GHz
41,032,528,741 instructions              #    0.63  insns per cycle
 6,560,579,013 branches                  #  227.183 M/sec
 1,646,394,749 branch-misses             #   25.10% of all branches
  28.935500947 seconds time elapsed
It can also do source code annotation with dissassembly.
perf record -e branch-misses ./sumtest_unsorted
perf annotate -d sumtest_unsorted
 Percent |      Source code & Disassembly of sumtest_unsorted
------------------------------------------------
...
         :                      sum += data[c];
    0.00 :        400a1a:       mov    -0x14(%rbp),%eax
   39.97 :        400a1d:       mov    %eax,%eax
    5.31 :        400a1f:       mov    -0x20040(%rbp,%rax,4),%eax
    4.60 :        400a26:       cltq
    0.00 :        400a28:       add    %rax,-0x30(%rbp)
...
See the performance tutorial for more details.


---

Score 1632

I just read up on this question and its answers, and I feel an answer is missing.
A common way to eliminate branch prediction that I've found to work particularly good in managed languages is a table lookup instead of using a branch (although I haven't tested it in this case).
This approach works in general if:
it's a small table and is likely to be cached in the processor, and
you are running things in a quite tight loop and/or the processor can preload the data.
Background and why
From a processor perspective, your memory is slow. To compensate for the difference in speed, a couple of caches are built into your processor (L1/L2 cache). So imagine that you're doing your nice calculations and figure out that you need a piece of memory. The processor will get its 'load' operation and loads the piece of memory into cache -- and then uses the cache to do the rest of the calculations. Because memory is relatively slow, this 'load' will slow down your program.
Like branch prediction, this was optimized in the Pentium processors: the processor predicts that it needs to load a piece of data and attempts to load that into the cache before the operation actually hits the cache. As we've already seen, branch prediction sometimes goes horribly wrong -- in the worst case scenario you need to go back and actually wait for a memory load, which will take forever (in other words: failing branch prediction is bad, a memory load after a branch prediction fail is just horrible!).
Fortunately for us, if the memory access pattern is predictable, the processor will load it in its fast cache and all is well.
The first thing we need to know is what is small? While smaller is generally better, a rule of thumb is to stick to lookup tables that are <= 4096 bytes in size. As an upper limit: if your lookup table is larger than 64K it's probably worth reconsidering.
Constructing a table
So we've figured out that we can create a small table. Next thing to do is get a lookup function in place. Lookup functions are usually small functions that use a couple of basic integer operations (and, or, xor, shift, add, remove and perhaps multiply). You want to have your input translated by the lookup function to some kind of 'unique key' in your table, which then simply gives you the answer of all the work you wanted it to do.
In this case: >= 128 means we can keep the value, < 128 means we get rid of it. The easiest way to do that is by using an 'AND': if we keep it, we AND it with 7FFFFFFF; if we want to get rid of it, we AND it with 0. Notice also that 128 is a power of 2 -- so we can go ahead and make a table of 32768/128 integers and fill it with one zero and a lot of 7FFFFFFFF's.
Managed languages
You might wonder why this works well in managed languages. After all, managed languages check the boundaries of the arrays with a branch to ensure you don't mess up...
Well, not exactly... :-)
There has been quite some work on eliminating this branch for managed languages. For example:
for (int i = 0; i < array.Length; ++i)
{
   // Use array[i]
}
In this case, it's obvious to the compiler that the boundary condition will never be hit. At least the Microsoft JIT compiler (but I expect Java does similar things) will notice this and remove the check altogether. WOW, that means no branch. Similarly, it will deal with other obvious cases.
If you run into trouble with lookups in managed languages -- the key is to add a & 0x[something]FFF to your lookup function to make the boundary check predictable -- and watch it going faster.
The result of this case
// Generate data
int arraySize = 32768;
int[] data = new int[arraySize];
Random random = new Random(0);
for (int c = 0; c < arraySize; ++c)
{
    data[c] = random.Next(256);
}
/*To keep the spirit of the code intact, I'll make a separate lookup table
(I assume we cannot modify 'data' or the number of loops)*/
int[] lookup = new int[256];
for (int c = 0; c < 256; ++c)
{
    lookup[c] = (c >= 128) ? c : 0;
}
// Test
DateTime startTime = System.DateTime.Now;
long sum = 0;
for (int i = 0; i < 100000; ++i)
{
    // Primary loop
    for (int j = 0; j < arraySize; ++j)
    {
        /* Here you basically want to use simple operations - so no
        random branches, but things like &, |, *, -, +, etc. are fine. */
        sum += lookup[data[j]];
    }
}
DateTime endTime = System.DateTime.Now;
Console.WriteLine(endTime - startTime);
Console.WriteLine("sum = " + sum);
Console.ReadLine();


---

Score 1453

As data is distributed between 0 and 255 when the array is sorted, around the first half of the iterations will not enter the if-statement (the if statement is shared below).
if (data[c] >= 128)
    sum += data[c];
The question is: What makes the above statement not execute in certain cases as in case of sorted data? Here comes the "branch predictor". A branch predictor is a digital circuit that tries to guess which way a branch (e.g. an if-then-else structure) will go before this is known for sure. The purpose of the branch predictor is to improve the flow in the instruction pipeline. Branch predictors play a critical role in achieving high effective performance!
Let's do some bench marking to understand it better
The performance of an if-statement depends on whether its condition has a predictable pattern. If the condition is always true or always false, the branch prediction logic in the processor will pick up the pattern. On the other hand, if the pattern is unpredictable, the if-statement will be much more expensive.
Let’s measure the performance of this loop with different conditions:
for (int i = 0; i < max; i++)
    if (condition)
        sum++;
Here are the timings of the loop with different true-false patterns:
Condition                Pattern             Time (ms)
-------------------------------------------------------
(i & 0×80000000) == 0    T repeated          322
(i & 0xffffffff) == 0    F repeated          276
(i & 1) == 0             TF alternating      760
(i & 3) == 0             TFFFTFFF…           513
(i & 2) == 0             TTFFTTFF…           1675
(i & 4) == 0             TTTTFFFFTTTTFFFF…   1275
(i & 8) == 0             8T 8F 8T 8F …       752
(i & 16) == 0            16T 16F 16T 16F …   490
A “bad” true-false pattern can make an if-statement up to six times slower than a “good” pattern! Of course, which pattern is good and which is bad depends on the exact instructions generated by the compiler and on the specific processor.
So there is no doubt about the impact of branch prediction on performance!


---

Score 1388

One way to avoid branch prediction errors is to build a lookup table, and index it using the data.  Stefan de Bruijn discussed that in his answer.
But in this case, we know values are in the range [0, 255] and we only care about values >= 128.  That means we can easily extract a single bit that will tell us whether we want a value or not: by shifting the data to the right 7 bits, we are left with a 0 bit or a 1 bit, and we only want to add the value when we have a 1 bit.  Let's call this bit the "decision bit".
By using the 0/1 value of the decision bit as an index into an array, we can make code that will be equally fast whether the data is sorted or not sorted.  Our code will always add a value, but when the decision bit is 0, we will add the value somewhere we don't care about.  Here's the code:
// Test
clock_t start = clock();
long long a[] = {0, 0};
long long sum;
for (unsigned i = 0; i < 100000; ++i)
{
    // Primary loop
    for (unsigned c = 0; c < arraySize; ++c)
    {
        int j = (data[c] >> 7);
        a[j] += data[c];
    }
}
double elapsedTime = static_cast<double>(clock() - start) / CLOCKS_PER_SEC;
sum = a[1];
This code wastes half of the adds but never has a branch prediction failure.  It's tremendously faster on random data than the version with an actual if statement.
But in my testing, an explicit lookup table was slightly faster than this, probably because indexing into a lookup table was slightly faster than bit shifting.  This shows how my code sets up and uses the lookup table (unimaginatively called lut for "LookUp Table" in the code).  Here's the C++ code:
// Declare and then fill in the lookup table
int lut[256];
for (unsigned c = 0; c < 256; ++c)
    lut[c] = (c >= 128) ? c : 0;
// Use the lookup table after it is built
for (unsigned i = 0; i < 100000; ++i)
{
    // Primary loop
    for (unsigned c = 0; c < arraySize; ++c)
    {
        sum += lut[data[c]];
    }
}
In this case, the lookup table was only 256 bytes, so it fits nicely in a cache and all was fast.  This technique wouldn't work well if the data was 24-bit values and we only wanted half of them... the lookup table would be far too big to be practical.  On the other hand, we can combine the two techniques shown above: first shift the bits over, then index a lookup table.  For a 24-bit value that we only want the top half value, we could potentially shift the data right by 12 bits, and be left with a 12-bit value for a table index.  A 12-bit table index implies a table of 4096 values, which might be practical.
The technique of indexing into an array, instead of using an if statement, can be used for deciding which pointer to use.  I saw a library that implemented binary trees, and instead of having two named pointers (pLeft and pRight or whatever) had a length-2 array of pointers and used the "decision bit" technique to decide which one to follow.  For example, instead of:
if (x < node->value)
    node = node->pLeft;
else
    node = node->pRight;
this library would do something like:
i = (x < node->value);
node = node->link[i];
Here's a link to this code: Red Black Trees, Eternally Confuzzled
