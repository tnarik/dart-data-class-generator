# Dart Data-O-matic (DarDO)

Create dart data classes easily from simple classes with properties or JSON payloads, without writing boilerplate.

## Motivation

This is an extension based on [Dart Data Class Generator](https://github.com/bnxm/Dart-Data-Class-Generator) 0.5.0, by [BendixMa](https://github.com/bnxm). Although the **Dart Data Class Generator** is a very useful library, its code is structure a single file, and the concerns of the different functions and classes is not very well defined (a generator reads code and generates code partially, constructors are handled differently than other methods to be added, JSON processing is interspesed with the rest of the code, etc.).

There is also the nice [JSON to Dart](https://github.com/hiranthar/Json-to-Dart-Model) extension by [hirantha](https://.github.com/hiranthaR) which does a better job at parsing JSON (and provides some nice options like working from clipboard content), but is heavily opinionated, automates too many things for my taste and is too verbose on the UX.

In an attempt to make it more maintainable and provide better support for JSON within VSCode, without being opinionated about the packages to use for the different methods, this extension is a heavy refactoring of **Dart Data Class Generator** that:

* Preserves class compatibility with it (**quick actions are the same and will be in fact duplicated if you use both extensions**).
* Reduces unnecessary processing if the document is not changing
* Allows using your own templates for class generation via configuration (and **provides an under development template using built_value**) via a new command.
* Fixes some typos on configuration variables.
* Overall becomes simpler to maintain and migrate to Typescript.
* Starts from **0.6.0** so that it is easier to understand where it comes from and how it is not a patched version of **Dart Data Class Generator**.
* Allowed me to understand better howo VSCode extensions work.

If you are happy with what [Dart Data Class Generator](https://github.com/bnxm/Dart-Data-Class-Generator) does right now, you don't need any of these.

I'm currently focusing on the JSON parsing part of the extension, and check BendixMa repo weekly.


## Features (as per Dart Data Class Generator)

The generator can generate the constructor, `copyWith`, `toMap`, `fromMap`, `toJson`, `fromJson`, `toString`, operator `==` and `hashCode` methods for a class based on [class properties](#create-data-classes-based-on-class-properties) or [raw JSON](#create-data-classes-based-on-json-beta).

Additionally the generator has a couple of useful quickfixes to speed up your development process. See the [Additional Features Section](#additional-features) for more.

## Additional features

This extension is a refactoring of [BendixMa's](https://github.com/bnxm/Dart-Data-Class-Generator) to provide better single concern classes/libraries by decoupling reading/parsing from code generation. This way less opinionated Dart classes can be generated via template support (a `built_value` template is included) or even extensions to the source code. If you are interested only in the default class generation from properties, you should be happy already with the original [BendixMa extension](https://github.com/bnxm/Dart-Data-Class-Generator). Consider giving his repo a star on [GitHub](https://github.com/bnxm/Dart-Data-Class-Generator) or leave a review there on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=BendixMa.dart-data-class-generator) or on this modified extension page if you find it useful (leaving a review, I mean). :heart:

## Create Data Classes Based on Class Properties (as per Dart Data Class Generator)

![](assets/gif_from_class.gif)

### **Usage**

You can generate data classes either by the quick fix dialog or by running a command. In the quick fix dialog you have the option to not only generate whole data classes but also only specific methods. The command has the advantage of being able to generate multiple classes at the same time.

#### **Quick fix**

- Create a class with properties.
- Place your cursor on the first line of the class, the constructor or a field.
- Hit **CTRL + .** to open the quick fix dialog.
- Choose one of the available options.

#### **Command**

- Create a class with properties.
- Hit **CTRL + P / Command + Shift + P** to open the command dialog.
- Search for **Dart Data-O-matic (DarDO): Generate from class properties** and hit enter.
- When there are multiple classes in the current file, choose the ones you'd like to create data classes of in the dialog.

It is also possible to run the generator on an existing data class (e.g. when some parameters changed). The generator will then try to find the changes and replace the class with its updated version. **Note that custom changes to generated functions may be overriden**.

You can also customize the generator for example to use [Equatable](https://pub.dev/packages/equatable) for value equality. See the [Settings](#-settings) section for more options.

#### **Enums**

In order for `enums` to be correctly serialized from and to JSON, please annotate them using a comment like so:
```dart
// enum
final Enum myEnum;
```

#### Usage with Equatable

Although using the generator is fast, it still doesn't spare you from all the boiler plate necessary, which can be visually distracting. To reduce the amount of boiler plate needed, the generator works with **Equatable**. Just extend the class with `Equatable` or mix with `EquatableMixin` and the generator will use `Equatable` for value equality. 

<img width="512" src="assets/equatable_demo.gif"/>

You can also use the setting `dart-data-o-matic.useEquatable`, if you always want to use `Equatable` for value equality.

## Create Data Classes Based on JSON

![](assets/gif_from_json.gif)

### **Usage**

- Create an **empty dart** file.
- Paste the **raw JSON without modifying it** into the otherwise empty file.
- Hit **CTRL + P / Command + Shift + P** to open the command dialog.
- Search for **Dart Data-O-matic (DarDO): Generate from JSON** and hit enter.
- Enter a class name in the input dialog. This will be the name of the **top level class** if the JSON contains nested objects, all other class names will be infered from the JSON keys.
- When there are nested objects in the JSON, a dialog will be appear if you want to separate the classes into multiple files or if all classes should be in the same file.



## Create Data Classes Based on JSON (templated)

### **Usage**

- Create an **empty dart** file.
- Paste the **raw JSON without modifying it** into the otherwise empty file (or modify it if you wish)
- Hit **CTRL + P / Command + Shift + P** to open the command dialog.
- Search for **Dart Data-O-matic (DarDO): Generate from JSON (templated)** and hit enter.
- Select a template (additional templates can be added via settings).
- Enter a class name in the input dialog. This will be the name of the **top level class** if the JSON contains nested objects, all other class names will be infered from the JSON keys.
- When there are nested objects in the JSON, a dialog will be appear if you want to separate the classes into multiple files or if all classes should be in the same file.


## Quick Actions

The extension includes some additional quick fixes that might be useful to you:

### Annotate parameters with @required

Quickly annotate parameters with @required while importing `package:meta/meta.dart` if there's no import for it already.

<img width="512" src="assets/required_demo.gif"/>

### Import refactoring

Sort imports alphabetically and bring them into the correct format easily.

<img width="512" src="assets/import_demo.gif"/>


## Settings (DarDO)

You can customize the generator to only generate the functions you want in your settings file. If you already have a **Dart Data Class Generator** configuration you like, you can reuse those settings by simply copying them and replacing `dart_data_class_generator` by `dart-data-o-matic`. The only exception is `dart-data-o-matic.json.separate`, which had a typo in the corresponding **Dart Data Class Generator** configuration.

* `dart-data-o-matic.quick_fixes`: If true, enables quick fixes to quickly generate data classes or specific methods only.
* `dart-data-o-matic.useEquatable`: If true, uses Equatable for value equality and hashCode.
* `dart-data-o-matic.fromMap.default_values`: If true, checks if a field is null when deserializing and provides a non-null default value.
* `dart-data-o-matic.constructor.default_values`: If true, generates default values for the constructor.
* `dart-data-o-matic.constructor.required`: If true, generates @required annotation for every constructor parameter. Note: The generator wont generate default values for the constructor if enabled!
* `dart-data-o-matic.json.separate`: Whether to separate a JSON generated data model into multiple files, when the JSON contains nested objects. ask: choose manually every time, separate: always separate into multiple files, current_file: always insert all classes into the current file.
* `dart-data-o-matic.override.manual`: If true, asks, when overriding a class (running the command on an existing class), for every single function/constructor that needs to be changed whether the generator should override the function or not. This allows you to preserve custom changes you made to the function/constructor that would be otherwise overwritten by the generator.
* `dart-data-o-matic.constructor.enabled`: If true, generates a constructor for a data class.
* `dart-data-o-matic.copyWith.enabled`: If true, generates a copyWith function for a data class.
* `dart-data-o-matic.toMap.enabled`: If true, generates a toMap function for a data class.
* `dart-data-o-matic.fromMap.enabled`: If true, generates a fromMap function for a data class.
* `dart-data-o-matic.toJson.enabled`: If true, generates a toJson function for a data class.
* `dart-data-o-matic.fromJson.enabled`: If true, generates a fromJson function for a data class.
* `dart-data-o-matic.toString.enabled`: If true, generates a toString function for a data class.
* `dart-data-o-matic.equality.enabled`: If true, generates an override of the == (equals) operator for a data class.
* `dart-data-o-matic.hashCode.enabled`: If true, generates a hashCode function for a data class.
* `dart-data-o-matic.hashCode.use_jenkins`: If true, uses the Jenkins SMI hash function instead of bitwise operator from dart:ui.
